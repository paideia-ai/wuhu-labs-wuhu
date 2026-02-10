import Foundation
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
import PiAI

struct MockHTTPClient: HTTPClient {
  var dataHandler: (@Sendable (URLRequest) async throws -> (Data, HTTPURLResponse))?
  var sseHandler: (@Sendable (URLRequest) async throws -> AsyncThrowingStream<SSEMessage, any Error>)?

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard let dataHandler else {
      throw PiAIError.unsupported("MockHTTPClient.dataHandler not set")
    }
    return try await dataHandler(request)
  }

  func sse(for request: URLRequest) async throws -> AsyncThrowingStream<SSEMessage, any Error> {
    guard let sseHandler else {
      throw PiAIError.unsupported("MockHTTPClient.sseHandler not set")
    }
    return try await sseHandler(request)
  }
}
