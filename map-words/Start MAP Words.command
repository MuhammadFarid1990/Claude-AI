#!/bin/bash
# MAP Words launcher for Mac.
# Opens the slideshow locked full screen on the projector, and the control page on the laptop.
# To close at the end: click the projector picture and press Command+Q.

URL="https://map-words.vercel.app/"
PROFILE="$HOME/Library/Application Support/MAPWordsBrowser"

BROWSER=""
for APP in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  if [ -x "$APP" ]; then BROWSER="$APP"; break; fi
done
if [ -z "$BROWSER" ]; then
  echo "Google Chrome is not installed. Install it from google.com/chrome, then run this again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi

# Find the projector (the screen without the menu bar) and take a point in its middle.
POS=$(osascript -l JavaScript -e '
ObjC.import("AppKit");
const s = $.NSScreen.screens;
const main = s.objectAtIndex(0).frame;
let out = "none";
if (s.count > 1) {
  const f = s.objectAtIndex(1).frame;
  const x = f.origin.x + f.size.width / 2 - 200;
  const y = (main.size.height - (f.origin.y + f.size.height)) + f.size.height / 2 - 150;
  out = Math.round(x) + "," + Math.round(y);
}
out;' 2>/dev/null)

if [ -z "$POS" ] || [ "$POS" = "none" ]; then
  echo
  echo "No projector found."
  echo "Connect the projector. In System Settings > Displays, make sure it is NOT mirroring,"
  echo "then run this again."
  echo
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi

echo "Opening the slideshow on the projector..."
nohup "$BROWSER" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --window-position="$POS" --window-size=400,300 \
  --kiosk --app="${URL}?screen" >/dev/null 2>&1 &
sleep 5

echo "Opening the control page on the laptop..."
nohup "$BROWSER" --user-data-dir="$PROFILE" --new-window --window-position=60,60 \
  --window-size=1300,850 "$URL" >/dev/null 2>&1 &
sleep 2
echo "Done. You can close this Terminal window."
