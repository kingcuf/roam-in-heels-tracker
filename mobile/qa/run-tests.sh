#!/bin/bash
# Compiles the real app sources + the edge-case suite to CJS and runs them in
# Node, with react-native stubbed (the suite only exercises pure logic).
set -uo pipefail
cd "$(dirname "$0")/.."
BUILD=qa/.build
rm -rf "$BUILD"

# Every *.test.ts under qa/ — compiled together, run in sequence below.
TESTS=(qa/*.test.ts)

npx tsc "${TESTS[@]}" \
  --ignoreConfig \
  --outDir "$BUILD" --rootDir . \
  --module commonjs --target es2019 --jsx react-jsx \
  --esModuleInterop --skipLibCheck --moduleResolution node10 --ignoreDeprecations 6.0 \
  --types node

# react-native stub — resolved before the real one because it sits closer to the build
mkdir -p "$BUILD/node_modules/react-native"
cat > "$BUILD/node_modules/react-native/index.js" <<'EOF'
const comp = (n) => n;
module.exports = {
  StyleSheet: { create: (s) => s },
  View: comp('View'), Text: comp('Text'), Pressable: comp('Pressable'),
  TouchableOpacity: comp('TouchableOpacity'), ScrollView: comp('ScrollView'),
  Modal: comp('Modal'), TextInput: comp('TextInput'), ActivityIndicator: comp('ActivityIndicator'),
  Animated: {
    Value: class { interpolate() { return 0; } },
    timing: () => ({ start() {} }),
    View: comp('Animated.View'),
  },
};
EOF
echo '{"name":"react-native","main":"index.js"}' > "$BUILD/node_modules/react-native/package.json"

status=0
for t in "${TESTS[@]}"; do
  name="$(basename "$t" .ts)"
  echo "── $name"
  node "$BUILD/qa/$name.js" || status=1
done
exit $status
