#!/bin/bash

NONROOT_USER=node
LOG=/tmp/container-init.log

# Execute the command it not already running
startInBackgroundIfNotRunning()
{
	log "Starting $1."
	echo -e "\n** $(date) **" | sudoIf tee -a /tmp/$1.log > /dev/null
	if [ ! -f "/tmp/$1.pid" ] || ! ps -p $(cat /tmp/$1.pid) > /dev/null; then
		echo "$4" | sudoIf tee -a /tmp/$1.log > /dev/null
		($3 sh -c "while true; do $4; sleep 5000; done 2>&1" | sudoIf tee -a /tmp/$1.log > /dev/null & echo "$!" | sudoIf tee /tmp/$1.pid > /dev/null)
		log "$1 started."
	else
		echo "$1 is already running." | sudoIf tee -a /tmp/$1.log > /dev/null
		log "$1 is already running."
	fi
}

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
sudoUserIf()
{
    if [ "$(id -u)" -eq 0 ]; then
        sudo -u ${NONROOT_USER} "$@"
    else
        "$@"
    fi
}

# Log messages
log()
{
    echo -e "[$(date)] $@" | sudoIf tee -a $LOG > /dev/null
}

log "** SCRIPT START **"

# Set up Xvfb
startInBackgroundIfNotRunning "Xvfb" "Xvfb" sudoIf "Xvfb ${DISPLAY:-:1} -screen 0 ${VNC_RESOLUTION:-1920x1080x16}"

# Start fluxbox as a light weight window manager. Keep it running if user exits it.
startInBackgroundIfNotRunning "fluxbox" "fluxbox" sudoUserIf "startfluxbox"

# Start x11vnc. We can hit a race condition where the display is not availabe yet, so keep trying if it fails
if type x11vnc 2>&1 > /dev/null; then
	startInBackgroundIfNotRunning "x11vnc" "x11vnc" sudoIf "x11vnc -display ${DISPLAY:-:1} -rfbport ${VNC_PORT:-5901}  -listen localhost -rfbportv6 ${VNC_PORT:-5901} -listenv6 localhost -xkb -shared -forever -nopw"
else
	log "Skipping x11vnc - not installed."
fi

# Spin up noVNC
if [ -d "/usr/local/novnc" ]; then
	startInBackgroundIfNotRunning "noVNC" "noVNC" sudoIf "/usr/local/novnc/noVNC*/utils/launch.sh --listen ${NOVNC_PORT:-6080} --vnc localhost:${VNC_PORT:-5901}"
else
	log "Skipping noVNC - not installed."
fi

# Start dbus
startInBackgroundIfNotRunning "dbus-daemon-system" "dbus-daemon --system" sudoIf "dbus-daemon --system"
startInBackgroundIfNotRunning "dbus-daemon-session" "dbus-daemon --session" sudoUserIf "dbus-daemon --session --address=unix:abstract=/tmp/dbus-session"

# Run whatever was passed in
log "Executing \"$@\"."
"$@"
log "** SCRIPT EXIT **"
