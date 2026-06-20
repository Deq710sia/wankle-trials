#!/usr/bin/env python3
"""
daemon-launcher.py — Double-fork daemon launcher for run-trials-robust.py.

The double-fork + setsid combo fully detaches from the controlling terminal
and parent process group, so the child survives even if the launching shell
is killed (which happens when our tool calls hit the 2-min context deadline).

Writes PID to /tmp/wankle-trials.pid so we can check status later.
"""
import os
import sys
import time
from pathlib import Path

WORK_DIR = '/home/z/my-project/scripts/cheat-tests'
LOG_FILE = f'{WORK_DIR}/robust-progress.log'
PID_FILE = '/tmp/wankle-trials.pid'
SCRIPT = f'{WORK_DIR}/run-trials-robust.py'

def daemonize():
    """Standard double-fork daemonization."""
    # First fork
    try:
        pid = os.fork()
        if pid > 0:
            # Parent exits immediately
            return False
    except OSError as e:
        sys.stderr.write(f'First fork failed: {e}\n')
        sys.exit(1)

    # Decouple from parent environment
    os.setsid()
    os.umask(0)

    # Second fork
    try:
        pid = os.fork()
        if pid > 0:
            os._exit(0)
    except OSError as e:
        sys.stderr.write(f'Second fork failed: {e}\n')
        os._exit(1)

    # Redirect std file descriptors to log file
    sys.stdout.flush()
    sys.stderr.flush()
    with open('/dev/null', 'r') as f:
        os.dup2(f.fileno(), 0)
    log_fd = os.open(LOG_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)

    # Write PID file
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))

    return True

def main():
    if daemonize():
        # We're the daemon child
        os.chdir(WORK_DIR)
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        # Use os.execvp so the daemon process IS python3 running the script
        os.execvpe('python3', ['python3', SCRIPT], env)

if __name__ == '__main__':
    main()
    # Parent path: print confirmation and exit
    print(f'Launched daemon. PID file: {PID_FILE}')
    time.sleep(1)
    if os.path.exists(PID_FILE):
        with open(PID_FILE) as f:
            pid = f.read().strip()
        print(f'Daemon PID: {pid}')
        # Check it's still alive
        try:
            os.kill(int(pid), 0)
            print(f'PID {pid} is alive')
        except:
            print(f'PID {pid} is NOT alive — check {LOG_FILE}')
