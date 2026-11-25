// viber-ax: background-only driver for Viber Desktop on macOS.
//
// It never activates Viber, never moves the pointer and never posts mouse or keyboard events: it only
// reads the accessibility tree, sets values / performs AX actions on Viber's own elements, and captures
// Viber's window image. Every command that changes Viber's UI refuses to run while Viber is the frontmost
// app, so it can never interfere with what the user is doing in Viber.
//
// Commands (one JSON object on stdout; errors as {"error": "...", "code": "..."}):
//   status                          running, frontmost, window, badge, permissions
//   tree                            window + flat list of elements {i,role,id,name,value,x,y,w,h,focused,actions}
//   ocr <png>                       capture Viber's window to <png> and return recognized text lines in screen points
//   (<idSubstring> may be "re:<regex>")
//   set <idSubstring> [nth]         AXValue := stdin (UTF-8) on the nth element whose AXIdentifier contains idSubstring
//   action <idSubstring> <AXAction> [nth] [times]   perform an AX action (AXPress, AXIncrement, AXDecrement…)
//   capture <png>                   capture Viber's window to <png>
//   permissions                     Accessibility / Screen Recording state and which app macOS charges them to
//   prompt                          add telegramcp to both permission lists (macOS shows its own prompts the first time)
//
// It ships as telegramcp.app (bin/telegramcp.app/Contents/MacOS/viber-ax). macOS charges Accessibility and
// Screen Recording to the "responsible" app, normally whatever started us: a bare `node`, Terminal, an AI app.
// So the helper re-launches itself once with that responsibility disclaimed, and the permissions belong to
// telegramcp.app: one entry with telegramcp's name and icon, whichever app runs the MCP server.
import AppKit
import ApplicationServices
import Vision

let BUNDLE = "com.viber.osx"

@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attr: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32
@_silgen_name("responsibility_get_pid_responsible_for_pid")
func responsibility_get_pid_responsible_for_pid(_ pid: pid_t) -> pid_t

let RELAUNCHED = "TELEGRAMCP_AX_RELAUNCHED"
if getenv(RELAUNCHED) == nil, Bundle.main.bundleIdentifier != nil, let exe = Bundle.main.executablePath {
  setenv(RELAUNCHED, "1", 1)
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
  let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  var child: pid_t = 0
  // No file actions: the child inherits stdin, stdout and stderr and talks to the caller directly.
  if posix_spawn(&child, exe, nil, &attr, argv, environ) == 0 {
    var status: Int32 = 0
    while waitpid(child, &status, 0) == -1 && errno == EINTR {}
    exit(status & 0x7f == 0 ? (status >> 8) & 0xff : 1)
  }
  // Could not re-launch: carry on, charged to the caller.
}
if getenv(RELAUNCHED) != nil {
  // The caller may kill the launcher on a timeout; don't outlive it.
  let parent = getppid()
  Thread.detachNewThread { while getppid() == parent { sleep(1) }; exit(2) }
}

func out(_ obj: Any) {
  let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func fail(_ msg: String, _ code: String = "error") -> Never { out(["error": msg, "code": code]); exit(1) }

let args = Array(CommandLine.arguments.dropFirst())
let cmd = args.first ?? ""

// The app macOS asks about: telegramcp itself, or (if the re-launch didn't happen) whatever runs us.
func chargedTo() -> [String: Any] {
  let me = getpid(), owner = responsibility_get_pid_responsible_for_pid(me)
  if owner == me || owner <= 0 { return ["self": true, "name": "telegramcp"] }
  var buf = [CChar](repeating: 0, count: 4096)
  let path = proc_pidpath(owner, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : ""
  // Name the .app when there is one: that's what System Settings lists.
  let app = path.range(of: #"^.*?\.app(?=/)"#, options: .regularExpression).map { String(path[$0]) }
  return ["self": false, "name": (app ?? path).split(separator: "/").last.map(String.init) ?? "", "path": app ?? path]
}
func permissions() -> [String: Any] {
  ["accessibility": AXIsProcessTrusted(), "screen_recording": CGPreflightScreenCaptureAccess(), "charged_to": chargedTo()]
}
let SETTINGS_HINT = "If telegramcp isn't listed there, run `telegramcp permissions` in Terminal: it adds it and opens the page."

if cmd == "permissions" { out(permissions()); exit(0) }
if cmd == "prompt" {
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  _ = AXIsProcessTrustedWithOptions(opts)
  if !CGPreflightScreenCaptureAccess() {
    _ = CGRequestScreenCaptureAccess()
    // macOS lists an app under Screen Recording only after it tries to capture: grab one pixel and drop it.
    let file = NSTemporaryDirectory() + "telegramcp-probe-\(getpid()).png"
    let cap = Process(); cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    cap.arguments = ["-x", "-R0,0,1,1", file]
    try? cap.run(); cap.waitUntilExit()
    try? FileManager.default.removeItem(atPath: file)
  }
  out(permissions())
  exit(0)
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: BUNDLE).first else {
  if cmd == "status" { out(permissions().merging(["running": false]) { a, _ in a }); exit(0) }
  fail("Viber is not running. Open Viber Desktop (it can stay in the background).", "not_running")
}
let pid = app.processIdentifier
let axApp = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(axApp, 3)

let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid

func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
  return v as? T
}
func axPoint(_ el: AXUIElement) -> CGPoint? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &v) == .success, let val = v else { return nil }
  var p = CGPoint.zero; AXValueGetValue(val as! AXValue, .cgPoint, &p); return p
}
func axSize(_ el: AXUIElement) -> CGSize? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &v) == .success, let val = v else { return nil }
  var s = CGSize.zero; AXValueGetValue(val as! AXValue, .cgSize, &s); return s
}

// Largest normal-layer on-screen window of Viber (the main window).
func windowInfo() -> [String: Any]? {
  guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
  let mine = list.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
  func area(_ w: [String: Any]) -> Double {
    let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
    return (b["Width"] ?? 0) * (b["Height"] ?? 0)
  }
  guard let w = mine.max(by: { area($0) < area($1) }), area(w) > 40_000, let b = w[kCGWindowBounds as String] as? [String: Double] else { return nil }
  return ["id": w[kCGWindowNumber as String] ?? 0, "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0,
          "onscreen": (w[kCGWindowIsOnscreen as String] as? Bool) ?? false]
}

func badge() -> String? {
  let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/lsappinfo")
  p.arguments = ["info", "-only", "StatusLabel", BUNDLE]
  let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
  guard (try? p.run()) != nil else { return nil }
  p.waitUntilExit()
  let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  guard let r = s.range(of: #""label"="[^"]*""#, options: .regularExpression) else { return nil }
  return String(s[r]).replacingOccurrences(of: #""label"=""#, with: "", options: .regularExpression).replacingOccurrences(of: "\"", with: "")
}

func mainWindow() -> AXUIElement? {
  if let w: AXUIElement = attr(axApp, kAXMainWindowAttribute) { return w }
  var v: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &v)
  if err == .cannotComplete {
    fail("Viber isn't answering accessibility requests right now. Try again in a minute; if it keeps happening, the user quits and reopens Viber.", "not_responding")
  }
  return (v as? [AXUIElement])?.first
}

struct Node { let el: AXUIElement; let info: [String: Any]; let id: String }

func collect() -> [Node] {
  guard let win = mainWindow() else { fail("Viber has no open window. Open it once from the Dock; it can stay in the background.", "no_window") }
  var nodes: [Node] = []
  func walk(_ el: AXUIElement, _ depth: Int) {
    if depth > 40 || nodes.count > 5000 { return }
    for k in (attr(el, kAXChildrenAttribute) as [AXUIElement]?) ?? [] {
      var info: [String: Any] = ["i": nodes.count, "d": depth]
      info["role"] = (attr(k, kAXRoleAttribute) as String?) ?? ""
      let id: String = attr(k, kAXIdentifierAttribute) ?? ""
      if !id.isEmpty { info["id"] = id }
      let name = (attr(k, kAXTitleAttribute) as String?) ?? (attr(k, kAXDescriptionAttribute) as String?) ?? ""
      if !name.isEmpty { info["name"] = name }
      if let v: String = attr(k, kAXValueAttribute), !v.isEmpty { info["value"] = v }
      else if let n: NSNumber = attr(k, kAXValueAttribute) { info["value"] = n }
      if let p = axPoint(k), let s = axSize(k) { info["x"] = p.x; info["y"] = p.y; info["w"] = s.width; info["h"] = s.height }
      if let f: Bool = attr(k, kAXFocusedAttribute), f { info["focused"] = true }
      var names: CFArray?
      if AXUIElementCopyActionNames(k, &names) == .success, let acts = names as? [String] {
        let useful = Array(Set(acts.filter { $0 != "AXRaise" && $0 != "AXShowMenu" })).sorted()
        if !useful.isEmpty { info["actions"] = useful }
      }
      nodes.append(Node(el: k, info: info, id: id))
      walk(k, depth + 1)
    }
  }
  var top: CFTypeRef?
  if AXUIElementCopyAttributeValue(win, kAXChildrenAttribute as CFString, &top) == .cannotComplete {
    fail("Viber isn't answering accessibility requests right now. Try again in a minute; if it keeps happening, the user quits and reopens Viber.", "not_responding")
  }
  walk(win, 0)
  return nodes
}

// needle: substring of AXIdentifier, or "re:<regex>" for a regular expression.
func find(_ needle: String, _ nth: Int) -> Node {
  let matches: [Node]
  if needle.hasPrefix("re:") {
    guard let re = try? NSRegularExpression(pattern: String(needle.dropFirst(3))) else { fail("bad regex \(needle)") }
    matches = collect().filter { re.firstMatch(in: $0.id, range: NSRange($0.id.startIndex..., in: $0.id)) != nil }
  } else {
    matches = collect().filter { $0.id.contains(needle) }
  }
  guard nth >= 0, nth < matches.count else { fail("No element matching \(needle) (#\(nth)); \(matches.count) found", "not_found") }
  return matches[nth]
}

// UI-changing commands must never compete with the user: refuse while Viber is in front.
func requireBackground() {
  if frontmost { fail("Viber is the active app right now (the user may be using it). Try again when Viber is in the background.", "in_use") }
}

func requireTrusted() {
  if !AXIsProcessTrusted() {
    fail("telegramcp needs the Accessibility permission. The user turns on \(permissionTarget()) in System Settings → Privacy & Security → Accessibility. \(SETTINGS_HINT)", "no_accessibility")
  }
}

// What System Settings lists: telegramcp, or the app running us if the re-launch didn't happen.
func permissionTarget() -> String {
  let c = chargedTo()
  if (c["self"] as? Bool) == true { return "\"telegramcp\"" }
  return "\"\(c["name"] ?? "")\" (\(c["path"] ?? ""), the app running telegramcp)"
}

// Viber's window as an image (Screen Recording), written to `file`.
func capture(_ file: String) -> ([String: Any], CGImage) {
  guard let w = windowInfo(), let wid = w["id"] as? Int else { fail("Viber has no window to read.", "no_window") }
  if (w["onscreen"] as? Bool) == false { fail("Viber's window is minimized or on another Space; it must be open (it can be behind other windows).", "offscreen") }
  if !CGPreflightScreenCaptureAccess() {
    fail("telegramcp needs the Screen Recording permission. The user turns on \(permissionTarget()) in System Settings → Privacy & Security → Screen & System Audio Recording. \(SETTINGS_HINT)", "no_screen_recording")
  }
  let cap = Process(); cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  cap.arguments = ["-x", "-o", "-l", String(wid), file]
  try? cap.run(); cap.waitUntilExit()
  guard cap.terminationStatus == 0, let img = NSImage(contentsOfFile: file),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("Could not capture Viber's window.", "capture_failed")
  }
  return (w, cg)
}

// Walking or changing Viber's accessibility tree from several processes at once (two AI apps, two copies of
// telegramcp) makes Viber stop answering. One at a time for this user; screen captures don't need the lock.
if ["tree", "set", "action"].contains(cmd) {
  let fd = open(NSTemporaryDirectory() + "telegramcp-viber-ax.lock", O_CREAT | O_RDWR, 0o600)
  if fd >= 0 { flock(fd, LOCK_EX) } // released when we exit
}

switch cmd {
case "status":
  var r = permissions().merging(["running": true, "pid": pid, "frontmost": frontmost]) { a, _ in a }
  if let w = windowInfo() { r["window"] = w }
  if let b = badge() { r["badge"] = b }
  out(r)

case "tree":
  requireTrusted()
  out(["window": windowInfo() ?? [:], "frontmost": frontmost, "elements": collect().map { $0.info }])

case "capture":
  guard args.count >= 2 else { fail("usage: capture <png>") }
  let (w, _) = capture(args[1])
  out(["window": w, "file": args[1]])

case "ocr":
  guard args.count >= 2 else { fail("usage: ocr <png>") }
  let (w, cg) = capture(args[1])
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.automaticallyDetectsLanguage = true
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let wx = w["x"] as! Double, wy = w["y"] as! Double, ww = w["w"] as! Double, wh = w["h"] as! Double
  let lines: [[String: Any]] = (req.results ?? []).compactMap { o in
    guard let c = o.topCandidates(1).first else { return nil }
    let b = o.boundingBox
    return ["text": c.string, "conf": Double(c.confidence),
            "x": wx + b.minX * ww, "y": wy + (1 - b.maxY) * wh, "w": b.width * ww, "h": b.height * wh]
  }
  out(["window": w, "image": ["w": cg.width, "h": cg.height], "lines": lines])

case "set":
  requireTrusted(); requireBackground()
  guard args.count >= 2 else { fail("usage: set <idSubstring> [nth]  (value on stdin)") }
  let value = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let n = find(args[1], args.count > 2 ? Int(args[2]) ?? 0 : 0)
  // Numeric elements (scroll bars) take a number, text elements a string.
  let current: CFTypeRef? = attr(n.el, kAXValueAttribute)
  let newValue: CFTypeRef = (current is NSNumber) ? NSNumber(value: Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0) : value as CFString
  let err = AXUIElementSetAttributeValue(n.el, kAXValueAttribute as CFString, newValue)
  guard err == .success else { fail("Setting the value failed (AX error \(err.rawValue))", "ax_failed") }
  usleep(120_000)
  let after: CFTypeRef? = attr(n.el, kAXValueAttribute)
  let shown: Any = (after as? String) ?? (after as? NSNumber) ?? ""
  out(["ok": true, "value": shown])

case "action":
  requireTrusted(); requireBackground()
  guard args.count >= 3 else { fail("usage: action <idSubstring> <AXAction> [nth] [times]") }
  let n = find(args[1], args.count > 3 ? Int(args[3]) ?? 0 : 0)
  let times = max(1, min(50, args.count > 4 ? Int(args[4]) ?? 1 : 1))
  for _ in 0..<times {
    let err = AXUIElementPerformAction(n.el, args[2] as CFString)
    guard err == .success else { fail("\(args[2]) failed (AX error \(err.rawValue))", "ax_failed") }
    usleep(40_000)
  }
  usleep(250_000)
  out(["ok": true])

default:
  fail("unknown command \"\(cmd)\"; see the header of viber-ax.swift")
}
