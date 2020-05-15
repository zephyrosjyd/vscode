#!/bin/bash

NONROOT_USER=node

# Skip setup if things are already up
if [ "$(ps -ef | grep 'dbus-daemon --session' | grep -v grep | wc -l)" != "0" ]; then
	echo "Script already run."
	# Run whatever was passed in
	"$@"
	exit 0
fi

# Use sudo to run as root when required
sudoIf()
{
    if [ "$(id -u)" -ne 0 ]; then
        sudo "$@"
    else
        "$@"
    fi
}

# Use sudo to run as non-root user if not already running
sudoUIf()
{
    if [ "$(id -u)" -eq 0 ]; then
        sudo -u ${NONROOT_USER} "$@"
    else
        "$@"
    fi
}

# Set up Xvfb, fluxbox, VNC, noVNC, and dbus for the user we will run as
(sudoIf Xvfb ${DISPLAY:-":1"} -screen 0 ${VNC_RESOLUTION:-"1920x1080x16"} 2>&1 | sudoIf tee /tmp/xvfb.log > /dev/null &)
(sudoUIf  sh -c "while true; do startfluxbox; sleep 1000; done" 2>&1 | sudoIf tee /tmp/fluxbox.log > /dev/null &)

# Start x11vnc. We can hit a race condition where the display is not availabe yet, so keep trying if it fails
(sudoIf sh -c "while true; do x11vnc -display ${DISPLAY:-':1'} -rfbport ${VNC_PORT:-'5901'}  -listen localhost -rfbportv6 ${VNC_PORT:-'5901'} -listenv6 localhost -xkb -shared -forever -nopw; sleep 1000; done" 2>&1 | sudoIf tee /tmp/x11vnc.log > /dev/null &)

# Spin up noVNC
(sudoIf /usr/local/novnc/noVNC*/utils/launch.sh --listen ${NOVNC_PORT:-"6080"} --vnc localhost:${VNC_PORT:-"5901"} 2>&1 | sudoIf tee /tmp/novnc.log > /dev/null &)

# Start dbus
(sudoIf dbus-daemon --system 2>&1 | sudoIf tee /tmp/dbus-daemon-system.log > /dev/null &)
(sudoUIf dbus-daemon --session --address=unix:abstract=/tmp/dbus-session 2>&1 | sudoIf tee /tmp/dbus-daemon-session.log > /dev/null &)

# Run whatever was passed in
"$@"
