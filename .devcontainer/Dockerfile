#-------------------------------------------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See https://go.microsoft.com/fwlink/?linkid=2090316 for license information.
#-------------------------------------------------------------------------------------------------------------

FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-10

ARG TARGET_DISPLAY=":1"

ARG INSTALL_VNC="true"
ARG TARGET_VNC_RESOLUTION=1280x720x16
ARG TARGET_VNC_PORT=5901

ARG INSTALL_NOVNC="true"
ARG NOVNC_VERSION=1.1.0
ARG TARGET_NOVNC_PORT=6080
ARG WEBSOCKETIFY_VERSION=0.9.0

ARG USERNAME=node

ENV DBUS_SESSION_BUS_ADDRESS="unix:abstract=/tmp/dbus-session" \
	VNC_RESOLUTION="${TARGET_VNC_RESOLUTION}" \
	VNC_PORT="${TARGET_VNC_PORT}" \
	NOVNC_PORT="${TARGET_NOVNC_PORT}" \
	DISPLAY="${TARGET_DISPLAY}"

COPY init.sh /usr/local/bin

# Configure apt and install packages
RUN apt-get update \
	&& export DEBIAN_FRONTEND=noninteractive \
	#
	# Install X11, fluxbox and VS Code dependencies
	&& apt-get install -y xvfb \
		fluxbox \
		xterm \
		libx11-dev \
		libxkbfile-dev \
		libsecret-1-dev \
		libnotify4 \
		libnss3 \
		libxss1 \
		libasound2 \
		gnome-keyring \
	&& mkdir -p /var/run/dbus \
	&& chmod +x /usr/local/bin/init.sh \
	#
	# TODO: https://github.com/microsoft/cascadia-code/releases/download/v2004.30/CascadiaCode_2004.30.zip
	#
	# Install VNC and noVNC
	&& if [ "${INSTALL_VNC}" = "true" ]; then \
		apt-get install -y x11vnc; \
	fi \
	&& if [ "${INSTALL_NOVNC}" = "true" ]; then \
		mkdir -p /usr/local/novnc \
		&& curl -sSL https://github.com/novnc/noVNC/archive/v${NOVNC_VERSION}.zip -o /tmp/novnc-install.zip \
		&& unzip /tmp/novnc-install.zip -d /usr/local/novnc \
		&& cp /usr/local/novnc/noVNC-${NOVNC_VERSION}/vnc_lite.html /usr/local/novnc/noVNC-${NOVNC_VERSION}/index.html \
		&& rm /tmp/novnc-install.zip \
		&& curl -sSL https://github.com/novnc/websockify/archive/v${WEBSOCKETIFY_VERSION}.zip -o /tmp/websockify-install.zip \
		&& unzip /tmp/websockify-install.zip -d /usr/local/novnc \
		&& apt-get -y install --no-install-recommends python-numpy \
		&& ln -s /usr/local/novnc/websockify-${WEBSOCKETIFY_VERSION} /usr/local/novnc/noVNC-${NOVNC_VERSION}/utils/websockify \
		&& rm /tmp/websockify-install.zip; \
	fi \
	#
	# Clean up
	&& apt-get autoremove -y \
	&& apt-get clean -y \
	&& rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/local/bin/init.sh"]
CMD ["sleep", "infinity"]
