#!/usr/bin/env bash
# Builds release/Riverbound.apk fully offline (no Google services, no Gradle):
# vite web build → aapt (manifest/resources/assets) → javac → dx → zipalign → apksigner.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK=/usr/lib/android-sdk
JAR=$SDK/platforms/android-23/android.jar
BT=$SDK/build-tools/debian
OUT=android/build
rm -rf "$OUT" && mkdir -p "$OUT/assets/web" "$OUT/obj" release
npx vite build --base ./ --outDir "$OUT/assets/web" --emptyOutDir
python3 android/make-icon.py android/res/mipmap-xxhdpi/ic_launcher.png android/res/mipmap-mdpi/ic_launcher.png
javac --release 8 -nowarn -classpath "$JAR" -d "$OUT/obj" android/src/de/riverbound/game/MainActivity.java
java -jar $BT/lib/dx.jar --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/obj"
aapt package -f -M android/AndroidManifest.xml -S android/res -A "$OUT/assets" -I "$JAR" -F "$OUT/unsigned.apk"
(cd "$OUT" && aapt add unsigned.apk classes.dex > /dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KS=android/riverbound-release.jks
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass riverbound -keypass riverbound -alias riverbound \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Riverbound, O=Riverbound, C=DE" > /dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:riverbound --key-pass pass:riverbound --ks-key-alias riverbound \
  --min-sdk-version 24 --out release/Riverbound.apk "$OUT/aligned.apk"
apksigner verify --print-certs release/Riverbound.apk | head -2
ls -la release/Riverbound.apk
