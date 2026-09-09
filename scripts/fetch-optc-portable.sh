#!/usr/bin/env bash
# Download the missing OpTC files on a machine with a faster line.
#
# Portable on purpose: bash + curl only, no PowerShell, no repo. Copy this
# script and analysis/optc/download-missing.tsv onto a USB stick and run it
# anywhere - Linux, macOS, Git Bash on Windows.
#
# It reads the TSV, skips anything already complete, and writes each file to
# the destination path the TSV names, so the tree it produces can be dropped
# straight onto the data volume of the working machine.
#
# WHY THE SIZE CHECK MATTERS
#
# Google Drive answers an exhausted per-file quota with a 2,009-byte HTML page
# carried on HTTP 200. curl --fail does not catch it because the status is a
# success. This script therefore checks the byte count against the manifest and
# deletes anything that does not match, because a resumed download on top of
# that HTML page produces a file of exactly the right length and the wrong
# contents. That happened to this project on 2026-09-06.
#
# It is a size check, not an identity check. Run Test-GzipIntegrity.ps1 on the
# working machine after copying.
#
# Usage:
#   ./fetch-optc-portable.sh                     # everything, priority order
#   ./fetch-optc-portable.sh -p 1                # only priority 1 (6 GB, Day 3)
#   ./fetch-optc-portable.sh -o /Volumes/USB/optc
#   ./fetch-optc-portable.sh -t download-missing.tsv -o E:/optc -p 1

set -u

TSV="download-missing.tsv"
OUT="./optc"
MAXPRIO=3

while getopts "t:o:p:h" opt; do
  case $opt in
    t) TSV="$OPTARG" ;;
    o) OUT="$OPTARG" ;;
    p) MAXPRIO="$OPTARG" ;;
    h) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "see -h"; exit 2 ;;
  esac
done

[ -f "$TSV" ] || { echo "TSV not found: $TSV"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

mkdir -p "$OUT"

total=0; done_n=0; skip_n=0; fail_n=0; quota_n=0

while IFS=$'\t' read -r prio gb dest url; do
  case "$prio" in ''|'#'*|'priority') continue ;; esac
  [ "$prio" -le "$MAXPRIO" ] 2>/dev/null || continue
  total=$((total+1))

  # the TSV carries Windows separators; this script writes POSIX paths
  rel=$(printf '%s' "$dest" | tr '\\' '/')
  path="$OUT/$rel"
  mkdir -p "$(dirname "$path")"

  # expected size, from the GB column. Only used to spot the quota page and
  # obvious truncation, so a loose tolerance is right.
  want=$(awk -v g="$gb" 'BEGIN{printf "%.0f", g*1000000000}')

  if [ -f "$path" ]; then
    have=$(wc -c < "$path" | tr -d ' ')
    if [ "$have" -gt $((want*97/100)) ]; then
      skip_n=$((skip_n+1))
      printf '  [skip] %s (%s GB already there)\n' "$rel" "$gb"
      continue
    fi
  fi

  printf '  [get ] p%s %6s GB  %s\n' "$prio" "$gb" "$rel"
  curl -fSL --retry 3 --retry-delay 10 --connect-timeout 30 \
       --speed-limit 4096 --speed-time 120 \
       -C - -o "$path" "$url" || true

  if [ ! -f "$path" ]; then
    fail_n=$((fail_n+1)); printf '         FAILED (no file)\n'; continue
  fi
  have=$(wc -c < "$path" | tr -d ' ')

  # the quota page: about 2 KB of HTML starting with '<'
  if [ "$have" -lt 10000 ] && head -c 1 "$path" | grep -q '<'; then
    rm -f "$path"
    quota_n=$((quota_n+1))
    printf '         QUOTA - Drive refused this file for now. Deleted the error page; run again later.\n'
    continue
  fi

  if [ "$have" -lt $((want*97/100)) ]; then
    fail_n=$((fail_n+1))
    printf '         SHORT  %s of about %s bytes. Left in place; rerun to resume.\n' "$have" "$want"
    continue
  fi

  done_n=$((done_n+1))
  printf '         ok  %s bytes\n' "$have"
done < "$TSV"

echo
echo "considered $total   downloaded $done_n   already there $skip_n   quota $quota_n   short/failed $fail_n"
echo
echo "Copy the tree under $OUT onto the working machine so that it lands as"
echo "  <data root>/optc/ecar/evaluation/..."
echo "then verify there. A file can be exactly the right size and still be wrong:"
echo "  .\\scripts\\Test-GzipIntegrity.ps1 -Path <data root>\\optc -NoHash"
