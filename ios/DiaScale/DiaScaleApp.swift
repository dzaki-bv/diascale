import SwiftUI

@main
struct DiaScaleApp: App {
    var body: some Scene {
        WindowGroup {
            DiaScaleWebView()
                .background(Color(red: 1, green: 254.0 / 255, blue: 250.0 / 255))
                .preferredColorScheme(.light)
        }
    }
}
