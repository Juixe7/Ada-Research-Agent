#!/usr/bin/env bash
# ==============================================================================
# Ada Deep Research: 1-Click AWS EC2 Small Setup Script
# Configures 2GB Swap Memory, Docker CE, Docker Compose, and Firewall
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Starting Ada Deep Research Setup for AWS EC2 Small       "
echo "=========================================================="

# 1. Create and enable 2GB Swap Memory (Prevents OOM Crashes)
if [ ! -f /swapfile ]; then
    echo "[1/4] Provisioning 2GB Linux swap space to guarantee stability..."
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "  ✓ 2GB swap space successfully created and enabled."
else
    echo "[1/4] Swap space already exists. Skipping."
fi

# 2. Update System Packages
echo "[2/4] Updating apt package repository..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw

# 3. Install Docker Engine & Docker Compose
if ! command -v docker &> /dev/null; then
    echo "[3/4] Installing Docker CE and Docker Compose plugin..."
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker "$USER"
    echo "  ✓ Docker installed successfully."
else
    echo "[3/4] Docker is already installed. Skipping."
fi

# 4. Configure Firewall (SSH, HTTP, HTTPS)
echo "[4/4] Configuring UFW firewall rules..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

echo "=========================================================="
echo " Setup Complete!                                          "
echo "                                                          "
echo " Next steps:                                              "
echo " 1. Log out and back in to apply docker group permissions:"
echo "    exit                                                  "
echo " 2. Create your .env file with your API keys:             "
echo "    nano .env                                             "
echo " 3. Launch Ada containers:                                "
echo "    docker compose up -d --build                          "
echo "=========================================================="
