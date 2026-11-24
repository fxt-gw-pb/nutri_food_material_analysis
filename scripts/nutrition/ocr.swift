// 用法：OCR_DPI=300 ./ocr <pdf> <起始页> <结束页> <输出目录> [旋转角度=-90] [img]
// 把扫描版 PDF 的每一页按 OCR_DPI（默认 300）渲染，旋转 -90°（成分表是横排印刷的），
// 用 macOS 自带的 Vision 文字识别，每页输出一个 JSON：[{text, x, y, w, h, conf}]，坐标原点在左上角。
// 第 6 个参数写 img 时同时保存渲染后的 JPG，方便人工核对。
// 编译：swiftc -O -o ocr ocr.swift
import Foundation
import Vision
import PDFKit
import AppKit
import CoreImage

let args = CommandLine.arguments
let pdfURL = URL(fileURLWithPath: args[1])
let first = Int(args[2])!, last = Int(args[3])!
let outDir = URL(fileURLWithPath: args[4])
let rotateDeg = args.count > 5 ? Int(args[5])! : -90
guard let doc = PDFDocument(url: pdfURL) else { fatalError("cannot open pdf") }

func renderPage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = CGFloat(Double(ProcessInfo.processInfo.environment["OCR_DPI"] ?? "300")!) / 72.0
    let w = Int(bounds.width * scale), h = Int(bounds.height * scale)
    // output rotated: swap w/h
    let ow = rotateDeg == 0 ? w : h, oh = rotateDeg == 0 ? h : w
    guard let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: ow, height: oh))
    if rotateDeg == -90 {
        // rotate clockwise by 90 so sideways text (reading bottom-to-top) becomes upright
        ctx.translateBy(x: 0, y: CGFloat(oh))
        ctx.rotate(by: -.pi / 2)
    } else if rotateDeg == 90 {
        ctx.translateBy(x: CGFloat(ow), y: 0)
        ctx.rotate(by: .pi / 2)
    }
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -bounds.minX, y: -bounds.minY)
    page.draw(with: .mediaBox, to: ctx)
    return ctx.makeImage()
}

for i in first...last {
    guard let page = doc.page(at: i - 1), let img = renderPage(page) else { continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    try? handler.perform([req])
    let W = CGFloat(img.width), H = CGFloat(img.height)
    var items: [[String: Any]] = []
    for obs in req.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        items.append(["text": cand.string, "conf": cand.confidence,
                      "x": Double(b.minX * W), "y": Double((1 - b.maxY) * H),
                      "w": Double(b.width * W), "h": Double(b.height * H)])
    }
    let out: [String: Any] = ["page": i, "width": Int(W), "height": Int(H), "items": items]
    let data = try! JSONSerialization.data(withJSONObject: out, options: [])
    try! data.write(to: outDir.appendingPathComponent(String(format: "p%03d.json", i)))
    if args.count > 6 {
        let rep = NSBitmapImageRep(cgImage: img)
        try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6])!.write(to: outDir.appendingPathComponent(String(format: "p%03d.jpg", i)))
    }
    print("page \(i): \(items.count) items")
}
