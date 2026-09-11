#!/usr/bin/env python3
"""A bounded supplemental guard. Never execute, expand, or log command input.

The native permission engine remains authoritative for commands not recognized
here; this is not a shell sandbox or a complete shell-language parser.
"""
import json
import os
import re
import shlex
import sys

PROTECTED = {'main', 'master', 'production', 'prod', 'release'}


def unwrap(words):
    words = list(words)
    while words:
        name = os.path.basename(words[0])
        if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*=.*', words[0]):
            words.pop(0)
        elif name in {'command', 'exec', 'builtin', 'nohup'}:
            words.pop(0)
            while words and words[0] in {'--', '-p'}:
                words.pop(0)
        elif name == 'env':
            words.pop(0)
            while words and (words[0] in {'-i', '--ignore-environment', '--'} or '=' in words[0]):
                words.pop(0)
        elif name == 'sudo':
            words.pop(0)
            while words and words[0] in {'-n', '-E', '--'}:
                words.pop(0)
        else:
            break
    return words


def inspect_segment(words, depth):
    words = unwrap(words)
    if not words:
        return None
    name, args = os.path.basename(words[0]), words[1:]
    if name in {'bash', 'sh', 'zsh', 'dash'} and depth < 3:
        for i, arg in enumerate(args[:-1]):
            if arg.startswith('-') and 'c' in arg[1:]:
                return classify(args[i + 1], depth + 1)
    if name == 'git':
        while args and args[0].startswith('-'):
            option = args.pop(0)
            if option in {'-C', '-c', '--git-dir', '--work-tree'} and args:
                args.pop(0)
        if not args:
            return None
        sub, flags = args[0], args[1:]
        if sub == 'reset' and '--hard' in flags:
            return 'git reset --hard'
        if sub == 'clean':
            short = ''.join(x[1:] for x in flags if x.startswith('-') and not x.startswith('--'))
            if 'f' in short and 'd' in short:
                return 'forced directory cleanup'
        if sub == 'push' and any(x == '-f' or x == '--force' or x.startswith('--force-with-lease') for x in flags):
            for arg in flags:
                target = arg.rsplit(':', 1)[-1].removeprefix('refs/heads/')
                if target in PROTECTED or target.startswith('release/'):
                    return 'forced push to protected branch'
    if name == 'rm':
        short = ''.join(x[1:] for x in args if x.startswith('-') and not x.startswith('--'))
        recursive = 'r' in short.lower() or '--recursive' in args
        force = 'f' in short or '--force' in args
        sensitive = {'/', '/*', '~', '~/', '$HOME', '$HOME/', '${HOME}', '${HOME}/', os.path.expanduser('~'), os.path.expanduser('~') + '/'}
        if recursive and force and any(x in sensitive for x in args):
            return 'recursive forced removal of root or home'
    if name in {'npx', 'pnpm', 'npm', 'bun'}:
        args = [x for x in args if x not in {'exec', '--', '-y', '--yes'}]
        if args and os.path.basename(args[0]).split('@', 1)[0] == 'supabase':
            name, args = 'supabase', args[1:]
    if name == 'supabase' and args[:2] == ['db', 'reset']:
        return 'database reset'
    return None


def classify(command, depth=0):
    if not isinstance(command, str) or len(command) > 131072:
        return None
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|()<>\n')
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        words = []
        for token in lexer:
            if token and all(c in ';&|()<>\n' for c in token):
                reason = inspect_segment(words, depth)
                if reason:
                    return reason
                words = []
            else:
                words.append(token)
        return inspect_segment(words, depth)
    except ValueError:
        return None


def main():
    try:
        raw = sys.stdin.read(262145)
        if len(raw) > 262144:
            return 0
        payload = json.loads(raw)
        tool = payload.get('tool_name', '')
        if tool not in {'Bash', 'exec_command', 'functions.exec_command'}:
            return 0
        args = payload.get('tool_input', {})
        reason = classify(args.get('command', args.get('cmd', '')))
    except (ValueError, TypeError, AttributeError):
        return 0
    if reason:
        print('Blocked destructive operation: ' + reason + '. Follow the explicit authorization and recovery workflow.', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
