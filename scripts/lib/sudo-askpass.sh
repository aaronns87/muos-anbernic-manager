#!/bin/sh
# SUDO_ASKPASS helper: graphical password prompt for `sudo -A`.
# osascript "with administrator privileges" cannot open /dev/rdisk* on modern macOS;
# real `sudo` can — this is how Etcher and others prompt for that sudo.
PW=$(/usr/bin/osascript <<'EOF'
activate
try
  set r to display dialog "muOS Anbernic Manager needs your password to write MustardOS to the SD card." default answer "" with title "Install MustardOS" with icon caution with hidden answer buttons {"Cancel", "OK"} default button "OK" cancel button "Cancel"
  return text returned of r
on error
  return ""
end try
EOF
) || exit 1
[ -n "$PW" ] || exit 1
printf '%s\n' "$PW"
