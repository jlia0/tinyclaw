#!/usr/bin/env python3
"""schedule.py — Create, list, and delete scheduled tasks that send messages
to the tinyclaw incoming queue with task context and target agent.

Schedules are stored in a JSON file (no crontab dependency) and executed
by a built-in scheduler loop (`run` command).

Usage:
    schedule.py create --cron EXPR --agent AGENT_ID --message MSG [--channel CH] [--sender S] [--label LABEL]
    schedule.py list   [--agent AGENT_ID]
    schedule.py delete --label LABEL
    schedule.py delete --all
    schedule.py run    (start the scheduler daemon loop)
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────

def resolve_tinyclaw_home() -> Path:
    project_root = Path(os.environ.get(
        "TINYCLAW_PROJECT_ROOT",
        Path(__file__).resolve().parent.parent.parent.parent,
    ))
    local = project_root / ".tinyclaw"
    if (local / "settings.json").is_file():
        return local
    return Path.home() / ".tinyclaw"


TINYCLAW_HOME = resolve_tinyclaw_home()
QUEUE_INCOMING = TINYCLAW_HOME / "queue" / "incoming"
SCHEDULES_FILE = TINYCLAW_HOME / "schedules.json"
LOG_FILE = TINYCLAW_HOME / "logs" / "schedule.log"

# ── Schedule store ───────────────────────────────────────────────────────────

def load_schedules() -> dict:
    if not SCHEDULES_FILE.is_file():
        return {}
    with open(SCHEDULES_FILE, "r") as f:
        data = json.load(f)
    return data.get("schedules", {})


def save_schedules(schedules: dict) -> None:
    SCHEDULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SCHEDULES_FILE, "w") as f:
        json.dump({"schedules": schedules}, f, indent=2)

# ── Cron matching (pure-Python, no external deps) ───────────────────────────

def _match_field(field: str, value: int, min_val: int, max_val: int) -> bool:
    """Check if a single cron field matches the given value."""
    for part in field.split(","):
        # Handle step: */N or range/N
        if "/" in part:
            base, step_str = part.split("/", 1)
            step = int(step_str)
            if base == "*":
                if (value - min_val) % step == 0:
                    return True
            elif "-" in base:
                lo, hi = (int(x) for x in base.split("-", 1))
                if lo <= value <= hi and (value - lo) % step == 0:
                    return True
            continue
        # Handle range: N-M
        if "-" in part:
            lo, hi = (int(x) for x in part.split("-", 1))
            if lo <= value <= hi:
                return True
            continue
        # Handle wildcard
        if part == "*":
            return True
        # Handle literal
        if int(part) == value:
            return True
    return False


def cron_matches(expr: str, dt: datetime) -> bool:
    """Check if a 5-field cron expression matches the given datetime (to the minute)."""
    fields = expr.split()
    if len(fields) != 5:
        return False
    minute, hour, dom, month, dow = fields
    return (
        _match_field(minute, dt.minute, 0, 59)
        and _match_field(hour, dt.hour, 0, 23)
        and _match_field(dom, dt.day, 1, 31)
        and _match_field(month, dt.month, 1, 12)
        and _match_field(dow, dt.isoweekday() % 7, 0, 7)  # 0=Sun, 7=Sun
    )


def validate_cron(expr: str) -> None:
    """Raise ValueError if the expression is not a valid 5-field cron string."""
    fields = expr.split()
    if len(fields) != 5:
        raise ValueError(f"Cron expression must have 5 fields, got {len(fields)}: {expr}")
    # Quick syntax check — try matching against an arbitrary datetime
    try:
        cron_matches(expr, datetime(2025, 1, 1, 0, 0))
    except Exception as e:
        raise ValueError(f"Invalid cron expression '{expr}': {e}")

# ── Queue writer ─────────────────────────────────────────────────────────────

def write_queue_message(label: str, agent: str, message: str,
                        channel: str, sender: str) -> None:
    """Write a JSON message into queue/incoming/ for the queue processor."""
    QUEUE_INCOMING.mkdir(parents=True, exist_ok=True)
    ts = int(time.time())
    msg_id = f"{label}_{ts}_{os.getpid()}"
    payload = {
        "channel": channel,
        "sender": sender,
        "senderId": f"tinyclaw-schedule:{label}",
        "message": f"@{agent} {message}",
        "timestamp": ts * 1000,
        "messageId": msg_id,
    }
    dest = QUEUE_INCOMING / f"{msg_id}.json"
    with open(dest, "w") as f:
        json.dump(payload, f, indent=2)
    return msg_id

# ── Logging ──────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass

# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_create(args: argparse.Namespace) -> None:
    validate_cron(args.cron)

    label = args.label or f"sched-{int(time.time())}-{os.getpid()}"
    schedules = load_schedules()

    if label in schedules:
        print(f"ERROR: A schedule with label '{label}' already exists. "
              "Delete it first or choose a different label.", file=sys.stderr)
        sys.exit(1)

    schedules[label] = {
        "cron": args.cron,
        "agent": args.agent,
        "message": args.message,
        "channel": args.channel,
        "sender": args.sender,
        "created_at": int(time.time()),
    }
    save_schedules(schedules)

    print("Schedule created:")
    print(f"  Label:   {label}")
    print(f"  Cron:    {args.cron}")
    print(f"  Agent:   @{args.agent}")
    print(f"  Message: {args.message}")
    print(f"  Channel: {args.channel}")


def cmd_list(args: argparse.Namespace) -> None:
    schedules = load_schedules()
    if not schedules:
        print("No tinyclaw schedules found.")
        return

    if args.agent:
        schedules = {k: v for k, v in schedules.items() if v["agent"] == args.agent}
        if not schedules:
            print(f"No schedules found for agent @{args.agent}.")
            return

    print("Tinyclaw schedules:")
    print("---")
    for label, s in schedules.items():
        created = datetime.fromtimestamp(s.get("created_at", 0)).strftime("%Y-%m-%d %H:%M")
        print(f"  Label:   {label}")
        print(f"  Cron:    {s['cron']}")
        print(f"  Agent:   @{s['agent']}")
        print(f"  Message: {s['message']}")
        print(f"  Channel: {s.get('channel', 'schedule')}")
        print(f"  Created: {created}")
        print("  ---")


def cmd_delete(args: argparse.Namespace) -> None:
    schedules = load_schedules()

    if args.all:
        count = len(schedules)
        if count == 0:
            print("No tinyclaw schedules to delete.")
            return
        save_schedules({})
        print(f"Deleted {count} tinyclaw schedule(s).")
        return

    if not args.label:
        print("ERROR: Provide --label LABEL or --all", file=sys.stderr)
        sys.exit(1)

    if args.label not in schedules:
        print(f"ERROR: No schedule found with label '{args.label}'.", file=sys.stderr)
        sys.exit(1)

    del schedules[args.label]
    save_schedules(schedules)
    print(f"Deleted schedule: {args.label}")


def cmd_run(_args: argparse.Namespace) -> None:
    """Scheduler daemon — checks every 60s and fires matching schedules."""
    log("Scheduler started")

    running = True

    def handle_signal(signum, _frame):
        nonlocal running
        log(f"Received signal {signum}, shutting down...")
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Track which (label, minute) pairs already fired to avoid double-fires
    fired: set[tuple[str, str]] = set()

    while running:
        now = datetime.now()
        minute_key = now.strftime("%Y-%m-%d %H:%M")

        schedules = load_schedules()
        for label, s in schedules.items():
            fire_key = (label, minute_key)
            if fire_key in fired:
                continue
            if cron_matches(s["cron"], now):
                fired.add(fire_key)
                msg_id = write_queue_message(
                    label=label,
                    agent=s["agent"],
                    message=s["message"],
                    channel=s.get("channel", "schedule"),
                    sender=s.get("sender", "Scheduler"),
                )
                log(f"Fired schedule '{label}' -> @{s['agent']} (msg: {msg_id})")

        # Prune old fired keys (keep only current minute)
        fired = {(l, m) for l, m in fired if m == minute_key}

        # Sleep in small increments so signals are handled promptly
        for _ in range(60):
            if not running:
                break
            time.sleep(1)

    log("Scheduler stopped")

# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Manage tinyclaw scheduled tasks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command")

    # create
    p_create = sub.add_parser("create", help="Create a new schedule")
    p_create.add_argument("--cron", required=True, help="5-field cron expression")
    p_create.add_argument("--agent", required=True, help="Target agent ID")
    p_create.add_argument("--message", required=True, help="Task context / prompt")
    p_create.add_argument("--channel", default="schedule", help="Channel name (default: schedule)")
    p_create.add_argument("--sender", default="Scheduler", help="Sender name (default: Scheduler)")
    p_create.add_argument("--label", default="", help="Unique label (default: auto-generated)")

    # list
    p_list = sub.add_parser("list", help="List existing schedules")
    p_list.add_argument("--agent", default="", help="Filter by agent ID")

    # delete
    p_delete = sub.add_parser("delete", help="Delete a schedule")
    p_delete.add_argument("--label", default="", help="Label of schedule to delete")
    p_delete.add_argument("--all", action="store_true", help="Delete all schedules")

    # run
    sub.add_parser("run", help="Start the scheduler daemon loop")

    args = parser.parse_args()

    if args.command == "create":
        cmd_create(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "delete":
        cmd_delete(args)
    elif args.command == "run":
        cmd_run(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
