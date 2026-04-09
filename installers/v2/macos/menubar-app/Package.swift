// swift-tools-version:5.9
import PackageDescription

// Tadaima.app — the installed menu bar application. This is the single
// bundle that lands at /Applications/Tadaima.app; its Contents/Resources/
// is where the bundled Node runtime, the pinned agent, the first-run
// config GUI bundle, and the launchd plist template all live.
let package = Package(
    name: "TadaimaMenuBar",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "TadaimaMenuBar", targets: ["TadaimaMenuBar"]),
    ],
    targets: [
        .executableTarget(
            name: "TadaimaMenuBar",
            path: "Sources/TadaimaMenuBar"
        ),
    ]
)
