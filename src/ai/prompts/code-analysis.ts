export function getCodeAnalysisPrompt(code: string, framework: string): string {
  return `Analyze this ${framework} mobile app code and extract the following information as JSON:

1. **screens**: Array of screens/pages with:
   - name: Screen/component name
   - type: "activity" | "fragment" | "viewcontroller" | "screen"
   - elements: Array of interactive elements {id, type, text, accessibilityId}
   - navigation: Which screens this navigates to

2. **apiEndpoints**: Array of API calls with:
   - method: HTTP method
   - path: Endpoint URL/path
   - description: What the API does

3. **stateManagement**: How app state is managed (Redux, Provider, MobX, etc.)

4. **validationRules**: Input validation rules found (regex patterns, min/max, required fields)

5. **errorHandlers**: Error handling patterns (try/catch, error boundaries, error screens)

6. **permissions**: OS permissions requested (camera, location, storage, notifications, etc.)

7. **thirdPartySDKs**: External SDKs/libraries used (analytics, crash reporting, payment, etc.)

Framework-specific analysis for ${framework}:
${getFrameworkSpecificInstructions(framework)}

Respond with valid JSON only, no markdown fences or explanations.

Code:
${code}`;
}

function getFrameworkSpecificInstructions(framework: string): string {
  switch (framework) {
    case 'react-native':
      return `- Identify React Navigation stack/tab/drawer navigators
- Find useEffect, useState, useCallback hooks with side effects
- Detect Redux/Zustand/MobX store connections
- Identify native module bridges (NativeModules, TurboModules)
- Find FlatList/SectionList components for scroll performance analysis
- Detect AsyncStorage/MMKV usage for local data
- Identify deep link handling (Linking API)`;

    case 'flutter':
      return `- Identify Navigator routes and named routes
- Find StatefulWidget lifecycle methods (initState, dispose)
- Detect Provider/Riverpod/BLoC state management
- Identify platform channel usage (MethodChannel)
- Find ListView/GridView builders for performance
- Detect SharedPreferences/Hive for local storage
- Identify GoRouter or auto_route for navigation`;

    case 'swift':
      return `- Identify UIViewController lifecycle methods (viewDidLoad, viewWillAppear)
- Find SwiftUI View structs and @State/@Binding properties
- Detect navigation (UINavigationController, NavigationStack, NavigationLink)
- Identify CoreData/Realm/UserDefaults usage
- Find URLSession/Alamofire network calls
- Detect push notification handling (UNUserNotificationCenter)
- Identify accessibility labels and identifiers`;

    case 'kotlin':
      return `- Identify Activity/Fragment lifecycle methods (onCreate, onResume)
- Find Jetpack Compose @Composable functions and remember/mutableStateOf
- Detect Navigation Component usage (NavController, NavGraph)
- Identify Room/SharedPreferences for local storage
- Find Retrofit/OkHttp/Ktor network calls
- Detect ViewModel and LiveData/StateFlow usage
- Identify content descriptions for accessibility`;

    default:
      return `- Identify screen/view classes and their lifecycle
- Find navigation patterns between screens
- Detect network/API call patterns
- Identify local storage usage
- Find input validation logic`;
  }
}

export function getCodeSummaryPrompt(fileList: string[], framework: string): string {
  return `Given this ${framework} mobile app file structure, identify:

1. The main entry point
2. All screen/page files
3. Navigation configuration files
4. API service/client files
5. State management files
6. Configuration files

File list:
${fileList.join('\n')}

Respond with JSON grouping files by category. Only include files that clearly belong to each category.`;
}
