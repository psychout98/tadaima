// swift-tools-version:5.9
import PackageDescription

// TadaimaConfig.app — the first-run pairing wizard. Runs exactly once
// during the .pkg postinstall (invoked via `open -W` so the installer
// waits for it), exits 0 on success, and is then embedded as a sibling
// bundle inside Tadaima.app/Contents/Resources/.
let package = Package(
    name: "TadaimaConfig",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "TadaimaConfig", targets: ["TadaimaConfig"]),
    ],
    targets: [
        .executableTarget(
            name: "TadaimaConfig",
            path: "Sources/TadaimaConfig"
        ),
    ]
)
