// MapSkyLocate —— 用 macOS 原生 CoreLocation 取一次目前位置，把結果以一行 JSON 印到 stdout。
//
// 為什麼要自己做：Electron 在 macOS 上的 navigator.geolocation 有已知的問題——呼叫後會一直
// 卡住，既不回傳位置也不報錯，系統的定位授權視窗也不會跳出來。所以改由這支小工具直接呼叫
// 系統定位，主程式（main.js）再把結果交給網頁。
//
// 輸出（一行 JSON，離開時的 exit code 在括號裡）：
//   {"ok":true,"latitude":22.6,"longitude":120.3,"accuracy":65.0}   (0)
//   {"ok":false,"error":"denied"}       使用者不允許／系統定位服務關閉   (2)
//   {"ok":false,"error":"timeout"}      已授權但一直取不到座標          (3)
//   {"ok":false,"error":"unavailable"}  其他錯誤                        (4)
// 還沒授權時會呼叫系統的授權視窗，並一直等到使用者回答（由主程式決定最長等多久）。

import Foundation
import CoreLocation

final class Locator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var started = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func run() {
        handle(status: manager.authorizationStatus)
    }

    private func handle(status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined:
            // 第一次：跳出系統的「想使用你的位置」授權視窗，使用者回答後會再回到
            // locationManagerDidChangeAuthorization。
            manager.requestAlwaysAuthorization()
        case .restricted, .denied:
            finish(["ok": false, "error": "denied"], code: 2)
        default:
            startFix()
        }
    }

    private func startFix() {
        if started { return }
        started = true
        // 已經授權了，最多再等 30 秒取座標。
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.finish(["ok": false, "error": "timeout"], code: 3)
        }
        manager.startUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        handle(status: manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        manager.stopUpdatingLocation()
        finish([
            "ok": true,
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
        ], code: 0)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let e = error as? CLError {
            if e.code == .denied {
                finish(["ok": false, "error": "denied"], code: 2)
                return
            }
            if e.code == .locationUnknown {
                return // 暫時還沒有座標，繼續等
            }
        }
        finish(["ok": false, "error": "unavailable"], code: 4)
    }

    private func finish(_ obj: [String: Any], code: Int32) {
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        }
        fflush(stdout)
        exit(code)
    }
}

let locator = Locator()
locator.run()
RunLoop.main.run()
