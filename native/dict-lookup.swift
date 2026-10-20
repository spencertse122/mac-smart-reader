import CoreServices
import Foundation

// Usage: dict-lookup <term>. Prints the macOS Dictionary's plain-text definition; exit 1 when none.
let args = CommandLine.arguments
guard args.count > 1 else { exit(2) }
let term = args[1] as NSString
guard let def = DCSCopyTextDefinition(nil, term, CFRangeMake(0, term.length)) else { exit(1) }
print(def.takeRetainedValue() as String)
