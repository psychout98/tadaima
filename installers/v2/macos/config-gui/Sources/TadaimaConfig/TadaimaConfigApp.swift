import SwiftUI
import AppKit

@main
struct TadaimaConfigApp: App {
    var body: some Scene {
        WindowGroup("Tadaima Setup") {
            ContentView()
                .frame(width: 520, height: 460)
        }
        .windowResizability(.contentSize)
    }
}
