// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CoreImage
import ReplayKit

/// matras: Broadcast Upload Extension for screen sharing in gomon calls. The app listens on a unix
/// socket `rtc_SSFD` in the app group container (@livekit/react-native-webrtc ScreenCapturer,
/// started by `setScreenShareEnabled`); every frame goes there as a JPEG framed like an HTTP
/// message with Buffer-Width/Height/Orientation headers — Jitsi's broadcast sample, condensed.
final class SampleHandler: RPBroadcastSampleHandler {
    private var fd: Int32 = -1
    private let images = CIContext(options: nil)
    private var lastFrame: TimeInterval = 0

    // Keeps under the extension's 50 MB: half-size frames, at most ~15 per second.
    private let scale: CGFloat = 0.5
    private let minInterval: TimeInterval = 1.0 / 15

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String,
              let socketURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
                .appendingPathComponent("rtc_SSFD"),
              connect(to: socketURL.path) else {
            stop("Начните показ экрана из звонка в Matras")
            return
        }
    }

    override func broadcastFinished() {
        disconnect()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video, fd >= 0,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        let now = Date.timeIntervalSinceReferenceDate
        guard now - lastFrame >= minInterval else {
            return
        }
        lastFrame = now

        let orientation = (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString,
                                           attachmentModeOut: nil) as? NSNumber)?.uint32Value
            ?? CGImagePropertyOrientation.up.rawValue
        let image = CIImage(cvPixelBuffer: pixels).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let jpeg = images.jpegRepresentation(
                of: image, colorSpace: colorSpace,
                options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.6]) else {
            return
        }

        let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
        let headers = [
            "Content-Length": String(jpeg.count),
            "Buffer-Width": String(Int(image.extent.width)),
            "Buffer-Height": String(Int(image.extent.height)),
            "Buffer-Orientation": String(orientation),
        ]
        for (name, value) in headers {
            CFHTTPMessageSetHeaderFieldValue(message, name as CFString, value as CFString)
        }
        CFHTTPMessageSetBody(message, jpeg as CFData)
        guard let data = CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data? else {
            return
        }
        if !send(data) {
            stop("Показ экрана остановлен")
        }
    }

    // MARK: - Socket

    private func connect(to path: String) -> Bool {
        let s = socket(AF_UNIX, SOCK_STREAM, 0)
        guard s >= 0 else {
            return false
        }
        var noSigPipe: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard path.utf8.count < capacity else {
            close(s)
            return false
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: capacity) { _ = strncpy($0, path, capacity - 1) }
        }
        let connected = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            close(s)
            return false
        }
        fd = s
        return true
    }

    private func send(_ data: Data) -> Bool {
        data.withUnsafeBytes { raw -> Bool in
            guard var p = raw.baseAddress else {
                return false
            }
            var left = raw.count
            while left > 0 {
                let n = write(fd, p, left)
                if n < 0 && errno == EINTR {
                    continue
                }
                if n <= 0 {
                    return false
                }
                p += n
                left -= n
            }
            return true
        }
    }

    private func disconnect() {
        if fd >= 0 {
            close(fd)
            fd = -1
        }
    }

    private func stop(_ reason: String) {
        disconnect()
        finishBroadcastWithError(NSError(domain: "ScreenShare", code: 1,
                                         userInfo: [NSLocalizedFailureReasonErrorKey: reason]))
    }
}
