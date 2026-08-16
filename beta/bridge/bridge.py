#!/usr/bin/env python3
"""Loopback HTTP client for the Quicktext Bridge.

Quick start (from a shell):

    python3 bridge.py help                    # every verb, its args
    python3 bridge.py status                  # link state + compose tabs
    python3 bridge.py parseTemplate Grp Name  # trace a stored template, pretty-printed
    python3 bridge.py rpc getBrowserInfo      # any verb, raw JSON reply

As a module:

    from bridge import rpc
    rpc("parseTemplate", group="Grp", name="Name")   # -> {"ok": True, "result": {...}}

The bridge is a beta/dev-only automation surface: Quicktext spawns a native
helper that listens on this loopback port and forwards `cmd`/`args` to the live
parser. Every call answers `{ok, result}` — the payload is under `result`.

PORT and TOKEN are fixed by the helper (bridge/quicktext_bridge_host.py); they
are duplicated here rather than discovered because the helper is installed
outside the repo (Thunderbird launches it by path). Stdlib only.
"""

import json
import sys
import urllib.error
import urllib.request

PORT = 47656
TOKEN = "quicktext"
URL = f"http://127.0.0.1:{PORT}/rpc"


class BridgeDown(Exception):
    """The port is not answering — the bridge is off in Quicktext's options,
    Thunderbird is not running, or the helper is not installed. Distinct from an
    RPC that answered with an error, which comes back in the reply."""


def rpc(cmd, timeout=180, **args):
    """Call one bridge verb. Returns the decoded reply dict
    (`{"ok": True, "result": ...}` or `{"ok": False, "error": ...}`).
    Only an unreachable port raises (BridgeDown)."""
    body = json.dumps({"cmd": cmd, "args": args, "timeoutMs": timeout * 1000}).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 15) as f:
            return json.loads(f.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())
    except urllib.error.URLError as e:
        raise BridgeDown(
            f"no answer on 127.0.0.1:{PORT} ({e.reason}). Is Thunderbird "
            f"running, and is the bridge switched on in Quicktext's options?"
        ) from e


def _print_parse(result):
    """Pretty-print a `parse` result: the resolved output and a per-pass trace
    so it is obvious which pass (if any) drops a tag."""
    if result.get("source") is not None:
        print(f"source     : {result.get('source')!r}")
    print(f"boundTabId : {result.get('boundTabId')}   isPlainText: {result.get('isPlainText')}")
    if result.get("error"):
        print(f"ERROR      : {json.dumps(result['error'], indent=2)}")
    print(f"result     : {result.get('result')!r}")
    print(f"passes     : {result.get('passCount')}")
    for p in result.get("passes", []):
        tags = ", ".join(
            f"{t['tagName']}({'|'.join(t['variables'])})" if t["variables"] else t["tagName"]
            for t in p["tagsSeen"]
        ) or "—"
        print(f"  ── pass {p['pass']}  changed={p['changed']}  getTags: {tags}")
        print(f"       before: {p['before']!r}")
        print(f"       after : {p['after']!r}")


def _main(argv):
    if not argv or argv[0] in ("-h", "--help", "help") and len(argv) == 1 and argv[0] == "--help":
        print(__doc__)
        return 0
    cmd = argv[0]
    try:
        if cmd == "parseTemplate":
            # parseTemplate <group> <name>   (real [[TEXT=group|name]] path)
            if len(argv) < 3:
                print("usage: parseTemplate <group> <name>")
                return 1
            reply = rpc("parseTemplate", group=argv[1], name=argv[2])
            if not reply.get("ok"):
                print(f"refused: {reply.get('error')}")
                return 1
            _print_parse(reply["result"])
            return 0
        if cmd == "rpc":
            # bridge.py rpc <verb> [k=v ...]   (values parsed as JSON, else string)
            verb = argv[1]
            args = {}
            for pair in argv[2:]:
                k, _, v = pair.partition("=")
                try:
                    args[k] = json.loads(v)
                except ValueError:
                    args[k] = v
            print(json.dumps(rpc(verb, **args), indent=2))
            return 0
        # Bare verb with no args, e.g. `bridge.py status` / `bridge.py help`.
        print(json.dumps(rpc(cmd), indent=2))
        return 0
    except BridgeDown as e:
        print(f"BridgeDown: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
