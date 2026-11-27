# Recovered development history (26–27 November 2026)

This repository contains a reconstructed sequence of twelve preserved Docker build checkpoints from the MVP server, followed by the source snapshot currently published on `main`.

## What the timestamps mean

Checkpoint labels and times below come from Docker image metadata captured on the server. Times are shown in UTC and Moscow time (UTC+3). Git commits in this reconstructed sequence were created during recovery on 27 November 2026; their Git author/committer dates have not been backdated. The checkpoint timestamp appears in each commit message so the evidence and Git metadata remain distinct.

This is a recovery from preserved build snapshots, not a complete record of every edit or command made during development.

| Preserved image | Image creation time (UTC) | Moscow time |
|---|---:|---:|
| rollback-20261127 | 2026-11-26 21:17:58 | 2026-11-27 00:17:58 |
| candidate-20261127 | 2026-11-26 22:20:22 | 2026-11-27 01:20:22 |
| rollback-telemetry-20261127 | 2026-11-27 04:22:36 | 2026-11-27 07:22:36 |
| rollback-2026-11-27 | 2026-11-27 04:39:59 | 2026-11-27 07:39:59 |
| candidate-next | 2026-11-27 06:25:41 | 2026-11-27 09:25:41 |
| candidate-rerank | 2026-11-27 06:53:51 | 2026-11-27 09:53:51 |
| candidate-routed | 2026-11-27 09:16:27 | 2026-11-27 12:16:27 |
| candidate-intent | 2026-11-27 09:21:01 | 2026-11-27 12:21:01 |
| candidate-final | 2026-11-27 09:25:36 | 2026-11-27 12:25:36 |
| candidate | 2026-11-27 15:58:07 | 2026-11-27 18:58:07 |
| accuracy-update | 2026-11-27 16:29:07 | 2026-11-27 19:29:07 |
| quality-form | 2026-11-27 17:24:05 | 2026-11-27 20:24:05 |

## Data handling

Only application source and deployment files needed to reproduce the software were included. Environment files with secrets, corporate source documents, user questions/answers, evaluation logs, and operational queues were excluded from this public repository.

The server snapshots were recovered from Docker images. The latest recovered source is then aligned with the current application source on `main`, preserving both the historical checkpoints and the present working version.
