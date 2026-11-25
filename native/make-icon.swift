// Draws telegramcp's app icon into native/AppIcon.icns (used by bin/telegramcp.app, which macOS shows in
// Privacy & Security). Only needed when the icon changes: `swift native/make-icon.swift && git add native/AppIcon.icns`.
import AppKit

func draw(_ px: Int) -> Data {
  let s = CGFloat(px)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

  // macOS icon grid: an 824/1024 rounded square, centered.
  let inset = s * 100 / 1024, side = s - inset * 2
  let tile = NSBezierPath(roundedRect: NSRect(x: inset, y: inset, width: side, height: side),
                          xRadius: side * 0.225, yRadius: side * 0.225)
  NSGradient(starting: NSColor(srgbRed: 0.22, green: 0.70, blue: 0.96, alpha: 1),
             ending: NSColor(srgbRed: 0.10, green: 0.42, blue: 0.84, alpha: 1))!.draw(in: tile, angle: -90)

  // A chat bubble with a tail, and three dots: an agent reading a conversation.
  let b = NSRect(x: inset + side * 0.18, y: inset + side * 0.30, width: side * 0.64, height: side * 0.46)
  let bubble = NSBezierPath(roundedRect: b, xRadius: b.height * 0.42, yRadius: b.height * 0.42)
  let tail = NSBezierPath()
  tail.move(to: NSPoint(x: b.minX + b.width * 0.20, y: b.minY + b.height * 0.12))
  tail.line(to: NSPoint(x: b.minX + b.width * 0.08, y: b.minY - side * 0.10))
  tail.line(to: NSPoint(x: b.minX + b.width * 0.42, y: b.minY + b.height * 0.02))
  tail.close()
  bubble.append(tail)
  NSGraphicsContext.current?.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = NSColor(white: 0, alpha: 0.18)
  shadow.shadowOffset = NSSize(width: 0, height: -side * 0.012)
  shadow.shadowBlurRadius = side * 0.03
  shadow.set()
  NSColor.white.setFill()
  bubble.fill()
  NSGraphicsContext.current?.restoreGraphicsState()

  let r = b.height * 0.10
  NSColor(srgbRed: 0.12, green: 0.50, blue: 0.88, alpha: 1).setFill()
  for i in -1...1 {
    let c = NSPoint(x: b.midX + CGFloat(i) * r * 3.1, y: b.midY)
    NSBezierPath(ovalIn: NSRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)).fill()
  }

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

let here = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let set = FileManager.default.temporaryDirectory.appendingPathComponent("telegramcp-\(getpid()).iconset")
try? FileManager.default.removeItem(at: set)
try! FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
for pt in [16, 32, 128, 256, 512] {
  try! draw(pt).write(to: set.appendingPathComponent("icon_\(pt)x\(pt).png"))
  try! draw(pt * 2).write(to: set.appendingPathComponent("icon_\(pt)x\(pt)@2x.png"))
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", set.path, "-o", here.appendingPathComponent("AppIcon.icns").path]
try! p.run(); p.waitUntilExit()
try? FileManager.default.removeItem(at: set)
exit(p.terminationStatus)
