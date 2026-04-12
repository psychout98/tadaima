import Foundation

/// Thin HTTP client for POST /api/devices/pair/claim.
///
/// Request body (see packages/agent/src/setup.ts):
///   { "code": "<6-char code>", "name": "<device name>", "platform": "darwin" }
///
/// Response body:
///   { "deviceId", "deviceToken", "rdApiKey", "wsUrl" }
///
/// Any non-2xx response is surfaced to the UI as an error.
enum PairingClient {
    struct PairResponse: Decodable {
        let deviceId: String
        let deviceToken: String
        /// Optional — missing when RealDebrid is not configured on the relay.
        let rdApiKey: String?
        let wsUrl: String
        /// Client-assigned; not returned by the relay.
        var deviceName: String = ""
    }

    enum PairError: LocalizedError {
        case invalidURL(String)
        case httpError(Int, String)
        case network(String)

        var errorDescription: String? {
            switch self {
            case .invalidURL(let s): return "Relay URL is not a valid URL: \(s)"
            case .httpError(let code, let detail):
                return "Relay returned HTTP \(code): \(detail)"
            case .network(let msg):
                return "Network error: \(msg)"
            }
        }
    }

    static func claim(relayUrl: String, pairingCode: String) async throws -> PairResponse {
        let trimmed = relayUrl.trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let base = URL(string: trimmed),
              let url = URL(string: "\(trimmed)/api/devices/pair/claim"),
              base.scheme?.hasPrefix("http") == true
        else {
            throw PairError.invalidURL(relayUrl)
        }

        let deviceName = Host.current().localizedName ?? ProcessInfo.processInfo.hostName

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "code": pairingCode.uppercased(),
            "name": deviceName,
            "platform": "darwin",
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw PairError.network("no HTTP response")
            }
            guard (200..<300).contains(http.statusCode) else {
                let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
                    ?? String(data: data, encoding: .utf8) ?? "unknown error"
                throw PairError.httpError(http.statusCode, detail)
            }
            var decoded = try JSONDecoder().decode(PairResponse.self, from: data)
            decoded.deviceName = deviceName
            return decoded
        } catch let e as PairError {
            throw e
        } catch {
            throw PairError.network(error.localizedDescription)
        }
    }
}
