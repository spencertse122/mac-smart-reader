import CoreServices
import Foundation

// Usage: dict-lookup <term>        English definition (New Oxford American Dictionary, else the default dictionary)
//        dict-lookup --zh <term>   Oxford Chinese Dictionary (Simplified Chinese - English) definition
// Exit: 0 printed, 1 no entry, 2 bad usage, 3 Chinese dictionary not usable (missing or not downloaded).

@_silgen_name("DCSCopyAvailableDictionaries") func DCSCopyAvailableDictionaries() -> Unmanaged<CFSet>?

// Resolved at runtime so a future macOS without it degrades to "not usable" instead of failing to launch.
func identifier(_ d: DCSDictionary) -> String? {
  guard let h = dlopen(nil, RTLD_NOW), let f = dlsym(h, "DCSDictionaryGetIdentifier") else { return nil }
  typealias GetIdentifier = @convention(c) (DCSDictionary) -> Unmanaged<CFString>?
  return unsafeBitCast(f, to: GetIdentifier.self)(d)?.takeUnretainedValue() as String?
}

func dictionary(_ id: String) -> DCSDictionary? {
  let all = (DCSCopyAvailableDictionaries()?.takeRetainedValue() as NSSet?)?.allObjects ?? []
  for o in all {
    let d = unsafeBitCast(o as AnyObject, to: DCSDictionary.self)
    if identifier(d) == id { return d }
  }
  return nil
}

func define(_ d: DCSDictionary?, _ term: String) -> String? {
  let t = term as NSString
  return DCSCopyTextDefinition(d, t, CFRangeMake(0, t.length))?.takeRetainedValue() as String?
}

var args = Array(CommandLine.arguments.dropFirst())
let zh = args.first == "--zh"
if zh { args.removeFirst() }
guard let term = args.first, !term.isEmpty else { exit(2) }

if zh {
  guard let ocd = dictionary("com.apple.dictionary.zh_CN-en.OCD") else { exit(3) }
  if let def = define(ocd, term) { print(def); exit(0) }
  exit(define(ocd, "water") == nil ? 3 : 1) // listed but never downloaded: even a common word has no entry
}

// The default dictionary is only a fallback when NOAD can't be found: it may be a bilingual one the user ranked first.
let noad = dictionary("com.apple.dictionary.NOAD")
guard let def = noad != nil ? define(noad, term) : define(nil, term) else { exit(1) }
print(def)
