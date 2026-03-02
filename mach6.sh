#!/bin/bash
# Get the directory of the script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the script's directory
cd "$DIR"

# Start the mach6 daemon in the background
node dist/gateway/daemon.js --config=mach6.json &
