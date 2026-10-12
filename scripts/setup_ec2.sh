#!/usr/bin/env bash
# ==============================================================================
# Ada Deep Research — AWS EC2 t3.micro / t3.small (Ubuntu 24.04 LTS) Bootstrap
# ==============================================================================
# Safely & idempotently configures:
#   1. 4 GB SSD Swap file (/swapfile) so 1 GB (t3.micro) / 2 GB (t3.small) never OOMs during Docker builds
#   2. Docker Engine & Docker Compose v2 plugin
#   3. Docker JSON log rotation (max 10m x 3 files per container)
# ==============================================================================

set -euo pipefail

echo "=== [1/4] Checking & Allocating 4 GB Linux Swap File ==="
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q "/swapfile" /etc/fstab; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
    sudo sysctl vm.swappiness=10
    if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
        echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
    fi
    echo "✓ 4 GB Swap allocated and activated."
else
    echo "✓ /swapfile already exists."
fi
free -h

echo "=== [2/4] Installing Docker Engine & Docker Compose v2 ==="
if ! command -v docker &> /dev/null; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg git
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER" || true
    echo "✓ Docker Engine installed."
else
    echo "✓ Docker already installed: $(docker --version)"
fi

echo "=== [3/4] Configuring Docker Log Rotation ==="
if [ ! -f /etc/docker/daemon.json ]; then
    sudo mkdir -p /etc/docker
    cat <<EOF | sudo tee /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
    sudo systemctl restart docker
    echo "✓ Docker log rotation configured."
fi

echo "=== [4/4] Creating Application Directory ==="
mkdir -p "$HOME/ada-deep-research"
echo "✓ EC2 t3.small host is ready for deployment."
