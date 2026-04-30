// Directory names that the bot must not recurse into when scanning a target
// repo. These contain build outputs, package-manager checkouts, and vendor
// SDK source — none of which represent real app screens or entry points, but
// all of which are .swift/.kt/.ts files that pollute the screen list and
// silently overwhelm AI prompts.
//
// Two real production failures driven by this set being incomplete:
//   - 2026-04-29 Nola PR#8: ios/build/SourcePackages/checkouts/firebase-ios-sdk
//     contributed 100+ vendor screens (AuthDefaultUIDelegate, MFALoginView,
//     OAuthProviderTests, ...) which crowded out the real LanguageGateView in
//     the 60-screen prompt slice and caused AI launch-state parsing to fail.
//   - 2026-04-29 earlier run: ios/**/AppDelegate.swift glob picked up Firebase
//     sample apps under ios/build/DerivedData/SourcePackages/.../tvOSSample
//     before reaching the real AppRouter.swift.
//
// Hidden directories (`.build`, `.git`, `.gradle`) are filtered separately by
// the `name.startsWith('.')` check at each call site — kept out of this set so
// the same constant can be tested in isolation without that side rule.
export const BUILD_VENDOR_SKIP_DIRS = new Set<string>([
  'build',
  'DerivedData',
  'Pods',
  'Carthage',
  'vendor',
  'node_modules',
]);
