<p align="center">
  <picture>
    <source type="image/svg+xml" srcset="images/hero.svg">
    <img src="images/hero.png" alt="Greenfield: from a prose brief and an empty /app to a working app, graded in a live browser" width="880">
  </picture>
</p>

<p align="center">
  <strong>Measuring whether a coding agent can build a working web application from a prose brief alone.</strong>
</p>

<p align="center">
  <a href="#summary"><img alt="Built by Ethara.AI" src="https://img.shields.io/badge/built%20by-Ethara.AI-ee00ee.svg?labelColor=0d1220"></a>
  <a href="#scoring-methodology"><img alt="Scoring: workflows + pytest + rubric" src="https://img.shields.io/badge/scoring-workflows_·_pytest_·_rubric-7a99d1.svg?labelColor=0d1220"></a>
  <a href="#difficulty-tiers"><img alt="Difficulty: opus-5 combined_score, 1 run" src="https://img.shields.io/badge/difficulty-opus--5_combined__score%2C_1_run-9a7400.svg?labelColor=0d1220"></a>
</p>

<p align="center"><sub>
  <a href="#summary">Summary</a> · <a href="#whats-in-this-delivery">This delivery</a> · <a href="#repository-layout">Layout</a> · <a href="#difficulty-tiers">Tiers</a> · <a href="#results">Results</a> · <a href="#analysis">Analysis</a> · <a href="#coverage">Coverage</a> · <a href="#dataset-structure">Dataset</a> · <a href="#trajectory-structure">Trajectories</a> · <a href="#scoring-methodology">Scoring</a> · <a href="#running-a-task">Running</a>
</sub></p>

# Greenfield: Application Build Delivery

**Greenfield measures whether a coding agent can turn a prose product brief into a deployed,
working web application that a stranger can drive in a browser.**

Each task hands an agent a long-form product specification, an empty `/app` (`9ad38f7c` also starts with media files its brief documents) and a service stack
(PostgreSQL on almost every task, plus any of Mailpit, MinIO, Kill Bill, Keycloak, PocketBase and others), and asks it to ship
something that installs, builds, answers a health probe and survives the task's own pytest suite,
workflow checks and an LLM rubric that drives a real browser. There is no repository to patch and no
oracle diff to approximate.

This delivery is **broad and shallow: 209 tasks, 417 graded rollouts.** Every task carries one
`opus-5` run; 208 of the 209 also carry one `glm-5.3` run. With one run per task per model, every
per-task number here is **a single observation, not a rate**, and the two cohorts are only directly
comparable on the 208 tasks they share.

**Not one of the 417 rollouts passed every workflow.** Throughout this document **pass rate is
`combined_score`** from `final_score.json`, as a percentage, averaged over runs where more than one
is pooled:

```
combined_score = workflow^0.50 · pytest^0.25 · rubric^0.25
```

It is a partial-credit, geometric measure: one channel at zero takes the whole product to zero. This
is **not pass@k**.

> **Oracle score disclaimer.** The reference solution is guaranteed a score of 1.0 only on the
> deterministic channels (pytest). Wherever the LLM judge is involved, in the rubric on every task and
> in the workflows of 180 tasks, a perfect oracle score is not guaranteed. See
> [Oracle score](#oracle-score).

## Summary

| Property | Value |
| --- | --- |
| Tasks | 209 (25 from week 1, 50 from week 2, 70 from week 3, 64 new in week 4) |
| Models | `opus-5` (209 runs), `glm-5.3` (208 runs) |
| Runs per task per model | 1 |
| Graded rollouts | 417; 402 with `judge = "scored"`, 14 `deployment-failed`, 1 judge `invalid` |
| Languages | TypeScript (180), Python (20), Go (5), JavaScript (3), Rust (1) |
| Agent harness | `openhands-sdk` on Harbor 0.24.0 |
| Grader | `rewardkit-0.2.3`, LLM judge, 3 samples per criterion |
| Reward signal | pytest outcome pass rate, `reward.json` |

Across all 417 rollouts the corpus pass rate is **21.08%** (σ 0.2156, range 0.000-0.820). That
number mixes two cohorts and should not be quoted on its own.

**`opus-5` beats `glm-5.3` on 200 of 208 shared tasks** (`glm-5.3` wins `e76c8222`), by 33.40 points on average (largest gap 80.52
points on `188e98f8`). 7 shared tasks tie (both models score the same).

Two numbers travel together throughout and must not be confused. **Pass rate is `combined_score`**,
the headline measure of how much of a task the agent actually delivered. **`reward.json` carries
`reward`, the pytest outcome pass rate alone**, and it is the only number that trains anything;
the grader labels `combined_score` a diagnostic.

## What's in this delivery

- **25 tasks from the first delivery**, unchanged except that `glm-5.3` runs were added
  for `1bc089d6`, `3ed42748`, `5559ceaa`, `7a50c331`, `c8622c96` (week 2) and `1c568f2d`, `3a79fa7f`, `a6e8fa11` (week 3).
  `a6e8fa11` also ships its updated grader (new tests image) and both of its runs are graded by it, so its `opus-5`
  score is 78.06% (was 82.46% under the old grader).
- **50 tasks from the second delivery**, unchanged.
- **70 tasks from the third delivery**, unchanged.
- **64 new tasks in week 4**, each with one `opus-5` and one `glm-5.3` run. Before delivery their trajectories
  were checked for leaked provider ids (redacted to `[REDACTED]`), every `task.toml` loads in Harbor 0.24 and validates
  against its schema, and every scored run's scores recompute from its shipped `ctrf.json`, `judge.json` and
  `requirements.toml`.
- **1 task still carries `opus-5` only:** `065a9171`.

**Notes on the week 4 tasks.**

- **`glm-5.3` runs that stopped early:** on `16d8dda1`, `6d58f80f` and `e3a06c1e` the `glm-5.3` agent's terminal stopped
  responding and the run ended before the app was finished, so the run is scored `deployment-failed`. The `opus-5`
  run of each task is a full attempt, and it sets the tier.
- **`9bfc9b36`:** the brief lists the fields `PATCH /api/boats/<code>` accepts but not what happens to fields a request
  leaves out; both models answer 422 to a name-only PATCH. This does not change the `opus-5` score (its workflows fail
  for other reasons).
- **Slugs:** `ba54e903`, `9d9cc75d` and `ed56c586` carry slugs that are real brand or site names (`discord-com`,
  `tableau`, `codeofsagar`); the products in their briefs are invented ("Community Hub", "Lozenge", "Ottoline Rask
  Selected Builds"). The slug is part of the task identity (`uuid_v5`, image tags), so it is unchanged.
- **Graders corrected after QC:** the tests images of `017c1ef8`, `2a87ee8d`, `7e2aa12d`, `8b457374`, `a05f9e92` and
  `c955fb61` (instruction-following checks that failed compliant apps) and of `77da028d` and `89091e13` (the 90%
  workflow rule) were rebuilt and re-pinned. Only the corrected instruction-following tests were re-run, so only
  `if_score` changed; W, P, R and `combined_score` are as graded.

## Repository layout

```
kiro-greenfield/
├── README.md                 # this document
├── images/                   # hero and the composition-gap chart (light and dark)
└── <uuid>/                   # one self-contained directory per task (209)
    ├── task.toml, instruction.md, traceability-matrix.csv
    ├── environment/, solution/, tests/
    └── trajectories/
        ├── opus-5/run_1
        └── glm-5.3/run_1     # 208 of 209 tasks
```

Task directories are named by their `uuid_v5`, and every task is referred to by its 8-character
prefix. Each directory is a self-contained bundle: the brief, the environment that hosts it, a
reference solution, the grader, and the trajectories recorded against it. Every task's `task.toml`
also pins prebuilt multi-arch (`linux/amd64`, `linux/arm64`) env and tests images in ECR under
`[metadata.ecr]`.

Every table below is derived from the shipped `final_score.json`, `workflows.json`,
`verifier/` and `trajectory/trajectory.json` files. Nothing is hand-entered.

## Difficulty tiers

`task.toml` ships **no** `difficulty`, `pass_rate` or calibration fields in this delivery. The tiers
below are cut here, on the same bands as the wider Greenfield corpus, from the single `opus-5`
`combined_score` of each task:

| band | `combined_score` |
|---|---|
| `trivial` | ≥ 87.5% |
| `easy` | [50%, 87.5%) |
| `medium` | [37.5%, 50%) |
| `hard` | [25%, 37.5%) |
| `expert` | < 25% |

| tier | tasks on `opus-5` | tasks on `glm-5.3` (208) |
|---|--:|--:|
| `trivial` | 0 | 0 |
| `easy` | 24 | 4 |
| `medium` | 65 | 4 |
| `hard` | 85 | 7 |
| `expert` | 35 | 193 |

The two models put a task in the same band on **40 of 208** shared tasks. With one run per task,
a tier here is one draw, not a measured rate: a task one run away from a band edge could land in the
neighbouring band on a re-run. Treat these tiers as provisional until each task has repeated runs.

## Results

### Pass rate by task and model

Sorted by `opus-5`. `W` is workflows passed / total, `P` the pytest outcome pass rate, `R` the rubric
score. `—` means the task has no `glm-5.3` run; `wk` is the week the task was first delivered.

| Task | wk | `opus-5` | W | P | R | `glm-5.3` | W | P | R |
| --- | :-: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `bf768c0f` chess-match-arena | 4 | 82.01% | 15/19 | 0.968 | 0.750 | 38.49% | 8/19 | 0.908 | 0.136 |
| `dd09740b` agency-inquiry-desk | 2 | 81.07% | 11/14 | 0.973 | 0.719 | 37.11% | 3/14 | 0.735 | 0.562 |
| `188e98f8` roundkeeper | 3 | 80.52% | 8/12 | 0.946 | 1.000 | 0.00% | 0/12 | 0.135 | 0.267 |
| `acf3d1b6` video-credit-studio | 1 | 80.03% | 5/7 | 0.933 | 0.862 | 0.00% | 0/7 | 0.756 | 0.862 |
| `a8936445` stationkeeper | 1 | 78.07% | 10/14 | 0.921 | 0.790 | 59.53% | 6/14 | 0.865 | 0.790 |
| `a6e8fa11` furrowbook | 1 | 78.06% | 9/13 | 0.936 | 0.828 | 0.00% | 0/13 | 0.480 | 0.741 |
| `f9ef9fe2` pilotlight | 1 | 76.55% | 8/13 | 0.907 | 1.000 | 50.06% | 5/13 | 0.733 | 0.579 |
| `3a4f9c6b` keelson | 3 | 75.55% | 8/13 | 0.938 | 0.917 | 33.01% | 2/13 | 0.654 | 0.767 |
| `cc20dbf3` shedline | 1 | 75.37% | 9/13 | 0.930 | 0.724 | 22.79% | 1/13 | 0.630 | 0.724 |
| `d2fda3ba` cairn-field-notebook | 2 | 74.02% | 7/12 | 0.882 | 1.000 | 0.00% | 0/12 | 0.441 | 0.203 |
| `f0ef5446` partner-program-intake | 2 | 73.25% | 5/9 | 0.933 | 1.000 | 0.00% | 0/9 | 0.732 | 0.860 |
| `0fe016e0` feature-flag-rollout-ladder | 1 | 73.03% | 4/7 | 0.871 | 1.000 | 0.00% | 0/7 | 0.452 | 0.145 |
| `1bc089d6` stillhour | 1 | 72.18% | 7/12 | 0.926 | 0.862 | 0.00% | 0/12 | 0.638 | 0.569 |
| `a411b950` earshot-ladder | 4 | 69.97% | 6/11 | 0.919 | 0.877 | 0.00% | 0/11 | 0.324 | 0.415 |
| `03ec7574` treasury-quorum-console | 1 | 66.26% | 10/18 | 0.843 | 0.741 | 61.19% | 9/18 | 0.757 | 0.741 |
| `f7780386` passboard | 1 | 65.57% | 6/12 | 0.880 | 0.841 | 22.61% | 1/12 | 0.590 | 0.638 |
| `bc58b4f3` teamseat | 2 | 64.85% | 5/10 | 0.860 | 0.823 | 0.00% | 0/10 | 0.495 | 0.871 |
| `8f4910c6` rungboard | 2 | 62.14% | 6/13 | 0.843 | 0.831 | 0.00% | 0/13 | 0.236 | 0.864 |
| `1c568f2d` exhibit-clearance-desk | 1 | 60.86% | 5/11 | 0.841 | 0.789 | 0.00% † | 0/11 | 0.000 | 0.000 |
| `065a9171` tallow-cover | 1 | 55.62% | 5/14 | 0.793 | 0.946 | — | | | |
| `09ede887` conference-workshop-booking-vb | 2 | 54.94% | 3/9 | 0.820 | 1.000 | 51.34% | 3/9 | 0.739 | 0.846 |
| `107eb6d6` tour-freight-desk | 1 | 54.59% | 4/11 | 0.771 | 0.871 | 37.98% | 2/11 | 0.723 | 0.871 |
| `c8622c96` saltprint-desk | 1 | 51.54% | 5/14 | 0.830 | 0.667 | 0.00% | 0/14 | 0.420 | 0.228 |
| `3a79fa7f` efoil-build-checkout-vb | 1 | 51.40% | 5/15 | 0.868 | 0.724 | 0.00% † | 0/15 | 0.000 | 0.000 |
| `b3014344` pampero-build-ledger | 2 | 49.56% | 4/14 | 0.835 | 0.886 | 0.00% | 0/14 | 0.551 | 0.629 |
| `76b76d2d` halide-box-office | 2 | 49.40% | 5/15 | 0.673 | 0.797 | 0.00% | 0/15 | 0.575 | 0.750 |
| `0a24efbb` attendance-regularisation-desk | 2 | 48.86% | 3/11 | 0.833 | 0.919 | 26.19% | 1/11 | 0.706 | 0.806 |
| `5306a075` loomwise-evidence-desk | 1 | 48.84% | 4/13 | 0.758 | 0.793 | 0.00% | 0/13 | 0.439 | 0.741 |
| `be6632fd` hourline | 2 | 48.37% | 4/13 | 0.819 | 0.706 | 0.00% | 0/13 | 0.324 | 0.500 |
| `645c528a` headstring | 3 | 48.14% | 4/13 | 0.655 | 0.867 | 0.00% | 0/13 | 0.027 | 0.217 |
| `fa34a58b` nightplan-hub | 2 | 47.84% | 3/11 | 0.742 | 0.948 | 0.00% | 0/11 | 0.212 | 0.517 |
| `1e363484` fluxseal | 2 | 47.53% | 3/11 | 0.889 | 0.772 | 22.91% | 1/11 | 0.543 | 0.614 |
| `f872975f` kerfwell | 3 | 47.51% | 3/11 | 0.812 | 0.843 | 25.33% | 1/11 | 0.552 | 0.902 |
| `d4519147` scopewright | 2 | 47.37% | 3/12 | 0.902 | 0.893 | 0.00% | 0/12 | 0.719 | 0.804 |
| `14b4e0bc` strata-catalog | 2 | 47.19% | 4/15 | 0.811 | 0.860 | 0.00% | 0/15 | 0.358 | 0.632 |
| `7c716c2d` tallyroom | 2 | 47.11% | 4/14 | 0.763 | 0.790 | 0.00% | 0/14 | 0.226 | 0.742 |
| `5b2d9011` holdfast-nights | 4 | 46.81% | 4/14 | 0.866 | 0.679 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `a7893e48` hearthshift | 1 | 46.62% | 3/12 | 0.825 | 0.917 | 0.00% | 0/12 | 0.577 | 0.183 |
| `e3a06c1e` lowfield-voice-console | 4 | 46.62% | 4/14 | 0.731 | 0.792 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `66a9444b` kerf-frequencies | 1 | 46.40% | 3/12 | 0.785 | 0.944 | 0.00% | 0/12 | 0.194 | 0.704 |
| `c955fb61` slackwater | 4 | 46.32% | 3/13 | 0.865 | 1.000 | 0.00% | 0/13 | 0.260 | 0.788 |
| `8f987bee` data-pipeline-console | 4 | 46.26% | 3/13 | 0.860 | 1.000 | 0.00% | 0/13 | 0.449 | 0.919 |
| `a3966622` slackwater | 3 | 46.13% | 4/15 | 0.806 | 0.790 | 17.42% | 1/15 | 0.313 | 0.661 |
| `893ceba9` interline-desk | 3 | 46.08% | 3/12 | 0.797 | 0.905 | 0.00% | 0/12 | 0.430 | 0.679 |
| `941822d9` credwell | 1 | 45.73% | 3/13 | 0.821 | 1.000 | 0.00% | 0/13 | 0.095 | 0.448 |
| `1af7a951` lanternfish | 4 | 45.31% | 3/13 | 0.868 | 0.912 | 39.13% | 3/13 | 0.717 | 0.614 |
| `27e5c5d1` kinfold | 3 | 45.19% | 3/13 | 0.826 | 0.948 | 0.00% | 0/13 | 0.377 | 0.776 |
| `9cc31ad2` kerbline | 4 | 44.85% | 3/13 | 0.898 | 0.846 | 0.00% | 0/13 | 0.224 | 0.615 |
| `b76c0217` galley-docs | 3 | 44.85% | 3/13 | 0.832 | 0.914 | 0.00% | 0/13 | 0.211 | 0.276 |
| `cf669c8e` ommezwaai-feeler | 2 | 44.82% | 5/17 | 0.655 | 0.712 | 0.00% | 0/17 | 0.262 | 0.411 |
| `26e9a8b6` pennywasher | 4 | 44.68% | 3/13 | 0.836 | 0.895 | 0.00% | 0/13 | 0.207 | 0.579 |
| `d298cbbd` strikeproof | 3 | 44.60% | 3/13 | 0.883 | 0.841 | 0.00% | 0/13 | 0.573 | 0.667 |
| `8061ec0b` bellroll | 2 | 44.45% | 3/13 | 0.800 | 0.917 | 0.00% | 0/13 | 0.090 | 0.750 |
| `4d620ce5` tailboard | 4 | 44.27% | 3/13 | 0.856 | 0.843 | 0.00% | 0/13 | 0.271 | 0.657 |
| `0b297f2f` hangline | 2 | 44.13% | 3/13 | 0.872 | 0.817 | 0.00% | 0/13 | 0.414 | 0.633 |
| `05439808` saltreach | 2 | 43.96% | 3/12 | 0.861 | 0.694 | 24.04% | 1/12 | 0.693 | 0.694 |
| `688485a0` jarful | 4 | 43.73% | 3/14 | 0.861 | 0.925 | 0.00% | 0/14 | 0.296 | 0.537 |
| `4e567a88` lumenfold-dispatch | 2 | 43.65% | 3/12 | 0.779 | 0.746 | 0.00% | 0/12 | 0.500 | 0.600 |
| `fe5b78f3` pakka-berth | 2 | 43.52% | 3/12 | 0.769 | 0.746 | 20.39% | 1/12 | 0.490 | 0.508 |
| `91afea8e` chauraha-bazaar | 3 | 43.30% | 3/12 | 0.733 | 0.767 | 0.00% | 0/12 | 0.311 | 0.600 |
| `3e25b869` loafline | 2 | 43.12% | 3/13 | 0.708 | 0.917 | 0.00% | 0/13 | 0.194 | 0.783 |
| `9ad38f7c` haunted-ctf-leaderboard-vb | 4 | 42.90% | 2/10 | 0.847 | 1.000 | 0.00% | 0/10 | 0.518 | 0.591 |
| `2a87ee8d` lanternfold | 4 | 42.77% | 3/14 | 0.791 | 0.921 | 0.00% | 0/14 | 0.154 | 0.571 |
| `d5bda8ea` community-event-rsvp-vb | 2 | 42.75% | 3/14 | 0.811 | 0.897 | 41.44% | 3/14 | 0.792 | 0.810 |
| `3b1606ee` airfold | 3 | 42.74% | 3/14 | 0.784 | 0.926 | 0.00% | 0/14 | 0.386 | 0.632 |
| `d800c4c4` pegworth-desk | 4 | 42.66% | 3/13 | 0.733 | 0.849 | 0.00% | 0/13 | 0.349 | 0.717 |
| `630a5ba0` tidemark-planner | 4 | 42.65% | 3/13 | 0.847 | 0.733 | 0.00% | 0/13 | 0.167 | 0.400 |
| `1aa0da7f` wardline | 2 | 42.48% | 3/14 | 0.741 | 0.957 | 0.00% | 0/14 | 0.224 | 0.362 |
| `eec0a822` tidewright | 2 | 42.47% | 3/13 | 0.747 | 0.818 | 0.00% | 0/13 | 0.133 | 0.654 |
| `4e75f56f` opaline-bench-days | 2 | 42.26% | 3/14 | 0.769 | 0.903 | 0.00% | 0/14 | 0.323 | 0.774 |
| `a634f791` reference-desk | 3 | 41.78% | 2/10 | 0.791 | 0.963 | 0.00% | 0/10 | 0.647 | 0.840 |
| `ea8a9699` rushes | 4 | 41.77% | 2/10 | 0.888 | 0.857 | 0.00% | 0/10 | 0.175 | 0.753 |
| `5e58bb82` swathdeck | 2 | 41.76% | 5/22 | 0.745 | 0.790 | 35.83% | 5/22 | 0.520 | 0.613 |
| `e7dd0ed1` farshore-console | 2 | 41.73% | 4/18 | 0.732 | 0.838 | 0.00% † | 0/18 | 0.000 | 0.000 |
| `5308e86e` tallwind-banking-cockpit | 4 | 41.65% | 2/11 | 0.911 | 1.000 | 20.53% | 1/11 | 0.438 | 0.491 |
| `4f60dc8f` gloamwork-shot-rig | 3 | 41.62% | 3/14 | 0.853 | 0.766 | 0.00% | 0/14 | 0.353 | 0.594 |
| `8b457374` dotgain | 4 | 41.38% | 3/14 | 0.766 | 0.833 | 0.00% | 0/14 | 0.500 | 0.567 |
| `77da028d` darkframe-imaging-log | 4 | 41.27% | 3/13 | 0.767 | 0.710 | 0.00% † | 0/13 | 0.000 | 0.000 |
| `d14955b4` hushline | 3 | 39.82% | 2/12 | 0.905 | 1.000 | 0.00% | 0/12 | 0.613 | 0.667 |
| `1bd57c5f` snaglight-walkthrough | 2 | 39.66% | 4/19 | 0.744 | 0.750 | 0.00% | 0/19 | 0.233 | 0.804 |
| `376c7c28` stackfire-kiln-desk | 2 | 39.64% | 2/11 | 0.816 | 0.915 | 24.92% | 1/11 | 0.671 | 0.695 |
| `347522e8` railside | 2 | 39.51% | 3/14 | 0.750 | 0.708 | 16.66% | 1/14 | 0.317 | 0.477 |
| `a48ecbeb` ceibo-sparkling-mate | 2 | 38.64% | 2/12 | 0.803 | 1.000 | 0.00% | 0/12 | 0.224 | 0.097 |
| `8a7f3e55` relayline | 3 | 38.55% | 2/10 | 0.716 | 0.771 | 0.00% | 0/10 | 0.403 | 0.250 |
| `bcf42373` cinematic-developer-casebook-vb | 1 | 38.38% | 2/11 | 0.791 | 0.831 | 25.41% | 1/11 | 0.744 | 0.678 |
| `07f5444f` quirewell-stand-desk | 3 | 37.98% | 2/12 | 0.864 | 0.867 | 0.00% | 0/12 | 0.691 | 0.817 |
| `abdfc26d` phosphene-yard | 4 | 37.57% | 2/13 | 0.841 | 1.000 | 0.00% † | 0/13 | 0.000 | 0.000 |
| `15996f31` swarmline-bloom-desk | 1 | 37.53% | 2/11 | 0.600 | 1.000 | 0.00% | 0/11 | 0.383 | 0.844 |
| `e7e372c1` tracewell-treasury-record | 2 | 37.51% | 2/12 | 0.775 | 0.919 | 0.00% | 0/12 | 0.050 | 0.919 |
| `ba54e903` discord-com | 4 | 37.35% | 3/17 | 0.661 | 0.946 | 0.00% | 0/17 | 0.330 | 0.200 |
| `0d5b421c` saffron-slate-tables | 4 | 37.26% | 2/12 | 0.694 | 1.000 | 0.00% | 0/12 | 0.297 | 0.821 |
| `67d48d61` promptside | 2 | 37.01% | 2/13 | 0.888 | 0.893 | 0.00% | 0/13 | 0.533 | 0.768 |
| `fa0d1078` sudoku | 3 | 36.99% | 2/13 | 0.908 | 0.871 | 0.00% | 0/13 | 0.446 | 0.629 |
| `60c53cd9` highwater-window-lens | 4 | 36.88% | 2/13 | 0.865 | 0.903 | 0.00% | 0/13 | 0.360 | 0.129 |
| `671c7943` sollis-folio | 4 | 36.80% | 2/13 | 0.817 | 0.948 | 0.00% | 0/13 | 0.268 | 0.552 |
| `9b5bc422` oddment | 2 | 36.66% | 2/13 | 0.833 | 0.915 | 0.00% | 0/13 | 0.333 | 0.864 |
| `a9ab5d5e` twohouse-handover | 3 | 36.55% | 3/14 | 0.822 | 0.473 | 0.00% | 0/14 | 0.414 | 0.164 |
| `3ed42748` parcel-moon | 1 | 36.52% | 2/13 | 0.830 | 0.906 | 0.00% | 0/13 | 0.557 | 0.500 |
| `a46b8d45` fittings-desk | 3 | 36.32% | 2/11 | 0.790 | 0.667 | 0.00% | 0/11 | 0.590 | 0.632 |
| `becc71f7` ourlet-consignment-desk | 3 | 35.98% | 2/13 | 0.795 | 0.891 | 0.00% | 0/13 | 0.145 | 0.000 |
| `160e307e` due-coin | 3 | 35.96% | 2/13 | 0.919 | 0.768 | 0.00% | 0/13 | 0.282 | 0.585 |
| `bab772c1` perilune-ledger | 3 | 35.91% | 2/14 | 0.815 | 1.000 | 0.00% | 0/14 | 0.496 | 0.493 |
| `ed56c586` codeofsagar | 4 | 35.91% | 2/13 | 0.854 | 0.823 | 0.00% | 0/13 | 0.447 | 0.903 |
| `f3c2d550` stowdeck | 3 | 35.64% | 2/12 | 0.775 | 0.750 | 21.69% | 1/12 | 0.637 | 0.500 |
| `b8c9f8a4` open-bonnet | 4 | 35.55% | 2/13 | 0.750 | 0.900 | 0.00% | 0/13 | 0.009 | 0.683 |
| `e1d33317` fairline | 3 | 35.50% | 2/13 | 0.822 | 0.817 | 0.00% | 0/13 | 0.307 | 0.517 |
| `9533ebee` quillmoor-reserve | 3 | 35.48% | 2/14 | 0.777 | 1.000 | 0.00% | 0/14 | 0.394 | 0.619 |
| `659ff5a8` conecount-paddock | 2 | 35.47% | 2/13 | 0.836 | 0.800 | 0.00% | 0/13 | 0.060 | 0.691 |
| `96b27234` hearthtile | 4 | 35.40% | 2/14 | 0.876 | 0.879 | 0.00% | 0/14 | 0.490 | 0.530 |
| `7c59c163` plumtide-venue | 4 | 35.29% | 3/13 | 0.672 | 0.433 | 0.00% † | 0/13 | 0.000 | 0.000 |
| `410b0a62` tempoline | 3 | 35.14% | 3/14 | 0.609 | 0.545 | 0.00% | 0/14 | 0.228 | 0.712 |
| `89091e13` fernsquare-console | 4 | 35.06% | 2/14 | 0.821 | 0.902 | 0.00% | 0/14 | 0.104 | 0.354 |
| `dd026e33` lacquer-motor-house | 2 | 35.06% | 2/12 | 0.688 | 0.790 | 0.00% | 0/12 | 0.172 | 0.710 |
| `88261f7f` nightroll-inn-desk | 4 | 35.01% | 2/14 | 0.836 | 0.881 | 0.00% | 0/14 | 0.245 | 0.582 |
| `e524757a` hushfoot | 4 | 34.83% | 2/13 | 0.829 | 0.750 | 0.00% | 0/13 | 0.441 | 0.515 |
| `6d58f80f` lintel-drive | 4 | 34.81% | 2/13 | 0.740 | 0.838 | 0.00% † | 0/13 | 0.000 | 0.000 |
| `f37fc654` spindrift-commission-stage | 3 | 34.81% | 2/14 | 0.756 | 0.952 | 0.00% | 0/14 | 0.398 | 0.581 |
| `bfb67a27` tallyslate | 3 | 34.76% | 2/13 | 0.783 | 0.788 | 0.00% | 0/13 | 0.196 | 0.682 |
| `add1364c` lockset-custody-desk | 4 | 34.60% | 2/14 | 0.764 | 0.919 | 0.00% | 0/14 | 0.191 | 0.258 |
| `8e494b6a` elastic | 3 | 34.55% | 2/14 | 0.787 | 0.887 | 0.00% | 0/14 | 0.181 | 0.604 |
| `227e831a` skinout | 3 | 34.46% | 2/13 | 0.632 | 0.943 | 22.46% | 1/13 | 0.456 | 0.943 |
| `505ab434` rulehouse | 4 | 34.44% | 2/14 | 0.774 | 0.891 | 0.00% | 0/14 | 0.009 | 0.473 |
| `98013ee6` mothlight | 4 | 34.27% | 2/14 | 0.821 | 0.823 | 0.00% | 0/14 | 0.036 | 0.726 |
| `f160d048` candour-bench | 3 | 34.27% | 2/14 | 0.811 | 0.833 | 0.00% | 0/14 | 0.243 | 0.683 |
| `d09edabd` keyway-bench | 3 | 34.26% | 3/16 | 0.701 | 0.559 | 0.00% | 0/16 | 0.309 | 0.603 |
| `51b6db54` celmate | 4 | 34.21% | 2/14 | 0.706 | 0.950 | 0.00% | 0/14 | 0.126 | 0.400 |
| `017c1ef8` plainwork-network | 4 | 34.11% | 2/14 | 0.830 | 0.800 | 0.00% | 0/14 | 0.398 | 0.836 |
| `58393de0` quarkyard | 4 | 34.01% | 2/14 | 0.735 | 0.892 | 0.00% | 0/14 | 0.098 | 0.811 |
| `24601f10` cupfold | 3 | 33.83% | 2/14 | 0.796 | 0.806 | 0.00% | 0/14 | 0.257 | 0.500 |
| `e2a9b5bf` lowlamp-field-log | 3 | 33.81% | 2/14 | 0.672 | 0.954 | 0.00% | 0/14 | 0.109 | 0.954 |
| `19accd6d` wringbench | 4 | 33.57% | 2/14 | 0.697 | 0.893 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `ec70a373` pilotlight-kitchen-ledger | 4 | 33.51% | 2/14 | 0.811 | 0.761 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `4804911b` vasant-talkies-interval | 3 | 33.40% | 4/24 | 0.672 | 0.667 | 0.00% | 0/24 | 0.172 | 0.583 |
| `47925b4c` gevelwerk | 3 | 33.38% | 2/13 | 0.748 | 0.702 | 0.00% | 0/13 | 0.121 | 0.526 |
| `bec04d26` duefield | 4 | 33.13% | 2/14 | 0.863 | 0.683 | 0.00% | 0/14 | 0.053 | 0.468 |
| `98536410` tramela-estate | 4 | 33.12% | 2/14 | 0.754 | 0.782 | 0.00% | 0/14 | 0.278 | 0.564 |
| `16d8dda1` slatehall | 4 | 33.11% | 2/14 | 0.827 | 0.712 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `6783ee8a` brackenpad | 3 | 33.02% | 2/14 | 0.660 | 0.882 | 0.00% | 0/14 | 0.170 | 0.618 |
| `21fd03b2` rampwright-bench | 3 | 32.89% | 2/14 | 0.798 | 0.718 | 20.38% | 1/14 | 0.649 | 0.521 |
| `032b2af4` athlete-effort-network | 3 | 32.87% | 2/16 | 0.914 | 0.818 | 0.00% | 0/16 | 0.812 | 0.788 |
| `9d9cc75d` tableau | 4 | 32.74% | 2/14 | 0.740 | 0.761 | 0.00% ‡ | 0/14 | 0.230 | — |
| `02f905f6` shelfmark | 3 | 32.33% | 2/12 | 0.535 | 0.735 | 0.00% | 0/12 | 0.282 | 0.694 |
| `833c86e9` booking | 3 | 32.26% | 2/14 | 0.777 | 0.683 | 0.00% | 0/14 | 0.252 | 0.767 |
| `c6b27312` tinework-gallery | 3 | 32.22% | 2/14 | 0.774 | 0.682 | 0.00% | 0/14 | 0.233 | 0.379 |
| `634b5fff` last-bundle | 3 | 32.17% | 2/14 | 0.612 | 0.857 | 0.00% | 0/14 | 0.235 | 0.357 |
| `4e829e38` everyweek | 4 | 32.16% | 2/16 | 0.733 | 0.933 | 0.00% | 0/16 | 0.053 | 0.587 |
| `b6f559f3` halation-studio | 3 | 32.15% | 2/14 | 0.815 | 0.643 | 0.00% | 0/14 | 0.315 | 0.464 |
| `fb5153e6` turnstone-studio | 2 | 32.08% | 2/13 | 0.575 | 0.778 | 0.00% | 0/13 | 0.315 | 0.746 |
| `f4a90c29` wren-calendar | 3 | 31.73% | 3/21 | 0.685 | 0.724 | 0.00% | 0/21 | 0.210 | 0.534 |
| `5e2a947e` sprigmap | 4 | 31.66% | 2/14 | 0.636 | 0.775 | 0.00% | 0/14 | 0.068 | 0.535 |
| `7141c5af` semenza-desk | 4 | 31.19% | 2/13 | 0.618 | 0.647 | 0.00% | 0/13 | 0.244 | 0.147 |
| `a05f9e92` switchyard-desk | 4 | 31.19% | 3/14 | 0.553 | 0.373 | 0.00% | 0/14 | 0.088 | 0.458 |
| `c2102b00` tally-split | 2 | 30.47% | 2/18 | 0.805 | 0.867 | 0.00% | 0/18 | 0.283 | 0.583 |
| `e6d96b37` flan-specimen-desk | 4 | 29.18% | 2/14 | 0.425 | 0.836 | 0.00% | 0/14 | 0.000 | 0.045 |
| `946a8343` spurline | 3 | 28.73% | 2/14 | 0.465 | 0.719 | 0.00% | 0/14 | 0.039 | 0.360 |
| `1160b78d` switchlamp | 3 | 27.99% | 2/19 | 0.604 | 0.917 | 0.00% | 0/19 | 0.011 | 0.450 |
| `96c941d4` squallglass | 3 | 27.88% | 1/9 | 0.634 | 0.772 | 0.00% | 0/9 | 0.293 | 0.386 |
| `f527cbc8` clinchline | 2 | 27.62% | 3/24 | 0.678 | 0.549 | 0.00% | 0/24 | 0.261 | 0.231 |
| `4e9d79c2` wayticket | 4 | 27.44% | 2/19 | 0.554 | 0.923 | 0.00% | 0/19 | 0.142 | 0.354 |
| `740047f7` pensight | 4 | 27.42% | 1/12 | 0.814 | 1.000 | 0.00% | 0/12 | 0.262 | 1.000 |
| `5559ceaa` relay-bench | 1 | 27.39% | 1/11 | 0.750 | 0.907 | 0.00% | 0/11 | 0.619 | 0.704 |
| `450cf4b3` stationhouse | 3 | 27.26% | 1/12 | 0.870 | 0.914 | 20.16% | 1/12 | 0.493 | 0.483 |
| `c4542d52` holdfast-register | 3 | 27.24% | 1/12 | 0.793 | 1.000 | 0.00% | 0/12 | 0.133 | 0.456 |
| `7e2aa12d` mullion | 4 | 27.01% | 1/13 | 0.899 | 1.000 | 0.00% | 0/13 | 0.604 | 0.814 |
| `d7ccae7f` lastbell | 3 | 26.77% | 1/12 | 0.849 | 0.871 | 0.00% | 0/12 | 0.679 | 0.919 |
| `d974eab3` vireo-pace-story | 3 | 26.74% | 1/13 | 0.907 | 0.952 | 0.00% | 0/13 | 0.627 | 0.794 |
| `54c4ef10` edgeprint | 2 | 26.69% | 1/12 | 0.800 | 0.914 | 0.00% | 0/12 | 0.012 | 0.190 |
| `e70f63d8` cricheroes | 3 | 26.06% | 1/13 | 0.868 | 0.898 | 0.00% | 0/13 | 0.363 | 0.559 |
| `e387e0cd` lanternline | 2 | 25.77% | 1/13 | 0.811 | 0.919 | 21.42% | 1/13 | 0.432 | 0.823 |
| `fa58e169` twinrow | 3 | 25.72% | 1/13 | 0.871 | 0.849 | 0.00% | 0/13 | 0.267 | 0.641 |
| `bf208a6c` pinsheet | 3 | 25.66% | 1/14 | 0.886 | 0.960 | 0.00% | 0/14 | 0.293 | 0.811 |
| `001efc8f` rimewire | 4 | 25.56% | 1/13 | 0.828 | 0.871 | 0.00% † | 0/13 | 0.000 | 0.000 |
| `d21868a7` ditchbook | 3 | 25.38% | 1/13 | 0.807 | 0.869 | 0.00% | 0/13 | 0.377 | 0.836 |
| `a0fc74b8` undersign | 3 | 25.14% | 1/13 | 0.789 | 0.855 | 0.00% | 0/13 | 0.250 | 0.800 |
| `266cc9d1` spanwise | 4 | 24.95% | 1/12 | 0.706 | 0.790 | 0.00% | 0/12 | 0.459 | 0.484 |
| `e76c8222` seatweaver | 2 | 24.95% | 1/12 | 0.681 | 0.820 | 33.34% | 2/12 | 0.565 | 0.787 |
| `34eb8930` quillmere-drafts | 2 | 24.91% | 1/13 | 0.687 | 0.948 | 0.00% | 0/13 | 0.418 | 0.707 |
| `64cce043` lockbox-ledger | 3 | 24.79% | 1/14 | 0.875 | 0.846 | 0.00% | 0/14 | 0.008 | 0.723 |
| `7a50c331` governed-context-graph | 1 | 24.77% | 3/23 | 0.636 | 0.348 | 0.00% | 0/23 | 0.172 | 0.826 |
| `df84b04d` twigline | 4 | 24.73% | 1/14 | 0.779 | 0.942 | 0.00% | 0/14 | 0.029 | 0.767 |
| `6d707fb9` fio-contado | 4 | 24.54% | 1/13 | 0.781 | 0.785 | 0.00% | 0/13 | 0.175 | 0.400 |
| `ecaf9927` kerfline-bench | 3 | 24.54% | 1/13 | 0.613 | 1.000 | 0.00% | 0/13 | 0.306 | 0.613 |
| `b9ed6f48` sightline-hall | 3 | 24.47% | 1/14 | 0.794 | 0.885 | 0.00% | 0/14 | 0.186 | 0.513 |
| `eb62b28b` ocotillo-member-desk | 3 | 24.46% | 1/13 | 0.803 | 0.754 | 0.00% | 0/13 | 0.092 | 0.661 |
| `d9719209` upthread | 4 | 24.26% | 1/14 | 0.747 | 0.909 | 0.00% † | 0/14 | 0.000 | 0.000 |
| `d7d06515` corbel-draft | 3 | 24.14% | 1/13 | 0.683 | 0.841 | 0.00% | 0/13 | 0.098 | 0.580 |
| `b312aa10` lineboard | 2 | 24.12% | 1/14 | 0.798 | 0.831 | 0.00% | 0/14 | 0.505 | 0.644 |
| `63f5b422` plinth-site-builder | 2 | 24.07% | 1/13 | 0.649 | 0.873 | 0.00% | 0/13 | 0.117 | 0.825 |
| `aabda112` roundbook | 4 | 24.02% | 1/14 | 0.740 | 0.882 | 0.00% | 0/14 | 0.250 | 0.559 |
| `e1a41369` deedfall | 3 | 23.80% | 1/14 | 0.863 | 0.729 | 0.00% | 0/14 | 0.619 | 0.729 |
| `47bad8ab` overlap-crossword | 3 | 23.52% | 1/16 | 0.910 | 0.861 | 0.00% | 0/16 | 0.180 | 0.139 |
| `bc33abaa` orrery-studio | 1 | 23.31% | 1/14 | 0.708 | 0.817 | 0.00% | 0/14 | 0.333 | 0.733 |
| `7a9f19b5` southerly-lightfall | 2 | 23.24% | 1/14 | 0.667 | 0.857 | 0.00% | 0/14 | 0.389 | 0.714 |
| `d86110e9` pinbyte-switchyard | 4 | 22.23% | 1/16 | 0.679 | 0.921 | 0.00% | 0/16 | 0.198 | 0.651 |
| `8fa5cc17` quire-commonplace | 2 | 21.88% | 1/15 | 0.565 | 0.914 | 0.00% | 0/15 | 0.324 | 0.724 |
| `783662f0` plotwright | 2 | 20.07% | 1/18 | 0.575 | 0.914 | 0.00% | 0/18 | 0.345 | 0.466 |
| `ab3214bf` hourproof | 4 | 19.25% | 1/17 | 0.552 | 0.719 | 0.00% | 0/17 | 0.177 | 0.469 |
| `a0426c74` plotfold-sheets | 3 | 18.86% | 1/14 | 0.470 | 0.528 | 0.00% | 0/14 | 0.090 | 0.417 |
| `63bcee2d` plumbline | 1 | 18.08% | 1/13 | 0.181 | 1.000 | 0.00% | 0/13 | 0.056 | 0.381 |
| `b597bb9c` gatecut | 3 | 17.82% | 1/22 | 0.612 | 0.797 | 0.00% | 0/22 | 0.082 | 0.453 |
| `f9641a08` roam-house | 3 | 17.82% | 1/14 | 0.681 | 0.290 | 0.00% | 0/14 | 0.153 | 0.387 |
| `f5399a16` clapstick-desk | 2 | 16.12% | 1/19 | 0.349 | 0.700 | 0.00% | 0/19 | 0.101 | 0.157 |
| `0d31a2e4` pratfall-cup | 3 | 0.00% | 0/10 | 0.552 | 0.954 | 0.00% | 0/10 | 0.239 | 0.700 |
| `267caec2` cutline-awards-desk | 3 | 0.00% | 0/11 | 0.643 | 1.000 | 0.00% | 0/11 | 0.179 | 0.955 |
| `643d0eb4` governed-table-workspace | 4 | 0.00% | 0/4 | 0.962 | 0.917 | 0.00% | 0/4 | 0.848 | 0.875 |
| `8694c8f3` afterglass | 4 | 0.00% | 0/14 | 0.365 | 0.808 | 0.00% | 0/14 | 0.230 | 0.683 |
| `9371a8da` marginalia-room | 4 | 0.00% | 0/12 | 0.724 | 0.918 | 0.00% | 0/12 | 0.491 | 0.738 |
| `9bfc9b36` boltrope-loft-bench | 4 | 0.00% | 0/13 | 0.643 | 0.733 | 0.00% | 0/13 | 0.062 | 0.283 |
| `b6915223` elevens-fantasy | 3 | 0.00% | 0/13 | 0.559 | 0.917 | 0.00% | 0/13 | 0.221 | 0.317 |

† `deployment-failed`: the app did not pass the health gate, so the run is scored 0 and its rubric is not judged. The other model's run of each task deployed normally. Cause, from each run's grader record (`verifier/ctrf.json`):

- `001efc8f` glm-5.3: /api/health on :4173 did not return 200; app-4173.log: Error: Cannot find module '/srv/app/dist/server.js'.
- `16d8dda1` glm-5.3: build exited 1; app-build.log: error during build: Could not resolve entry module "index.html".
- `19accd6d` glm-5.3: the grader recorded no cause for this deployment failure.
- `1c568f2d` glm-5.3: /api/health on :4173 did not return 200; app-4173.log: psycopg.errors.UniqueViolation: duplicate key value violates unique constraint "pg_type_typname_nsp_index".
- `3a79fa7f` glm-5.3: build exited 1; app-build.log: Error: Command failed: npx tsc -p tsconfig.json.
- `5b2d9011` glm-5.3: the grader recorded no cause for this deployment failure.
- `6d58f80f` glm-5.3: /api/health on :4173 did not return 200.
- `77da028d` glm-5.3: /api/health on :4173 did not return 200; app-4173.log: ModuleNotFoundError: No module named 'psycopg'.
- `7c59c163` glm-5.3: /api/health on :4173 did not return 200; app-4173.log: Error: Cannot find module '/srv/app/dist/server.js'.
- `abdfc26d` glm-5.3: the grader recorded no cause for this deployment failure.
- `d9719209` glm-5.3: the grader recorded no cause for this deployment failure.
- `e3a06c1e` glm-5.3: the grader recorded no cause for this deployment failure.
- `e7dd0ed1` glm-5.3: /api/health on :4173 did not return 200; app-4173.log: Error: Cannot find module '/srv/app/dist/server.js'.
- `ec70a373` glm-5.3: the grader recorded no cause for this deployment failure.

‡ judge `invalid`: the judge result was not usable, so the run has no rubric score (`9d9cc75d` glm-5.3).

**7 tasks tie for the lowest `opus-5` score** at 0.00% (`0d31a2e4` pratfall-cup, `267caec2` cutline-awards-desk, `643d0eb4` governed-table-workspace, `8694c8f3` afterglass, `9371a8da` marginalia-room, `9bfc9b36` boltrope-loft-bench, `b6915223` elevens-fantasy); **`bf768c0f` chess-match-arena is the highest** at 82.01%
(15 of 19 workflows). `opus-5` scores zero on 7 of 209 tasks; `glm-5.3` on 179 of 208.

### Model comparison (208 shared tasks)

| | `opus-5` | `glm-5.3` | Δ |
| --- | ---: | ---: | ---: |
| Pass rate | 37.70% | 4.30% | -33.40 |
| Reward (pytest) | 77.11% | 32.38% | -44.73 |
| Workflows passed | 19.75% | 2.42% | -17.33 |
| Rubric `R` (judged runs) | 0.8379 | 0.5957 | -0.2422 |
| Tasks won | 200 | 1 | |

**Most `glm-5.3` zeros are workflow zeros.** 179 of its 179 zero-score runs passed no workflow, so
`workflow^0.50` is 0 and the product collapses even where pytest and rubric are above zero.

With n = 1 per task, no single-task gap can be separated from run-to-run noise.

## Analysis

**Check accuracy does not survive composition.** On the 208 shared tasks `opus-5` passes 78.0% of
pytest outcome cases but only **19.8% of workflows**; `glm-5.3` passes 34.2% of cases and **2.4%
of workflows**. A workflow passes only when at least 90% of its steps pass **and** none of its
critical steps fail, so partial
competence collapses at the join.

| Channel (208 shared tasks) | `opus-5` | `glm-5.3` |
| --- | ---: | ---: |
| Workflows | 554 / 2,805 (19.75%) | 68 / 2,805 (2.42%) |
| Pytest outcome cases | 16,564 / 21,234 (78.01%) | 7,225 / 21,138 (34.18%) |
| `if_score` (instruction-following cases), mean over deployed runs | 0.9578 | 0.8435 |
| Critical-case failures | 3,644 | 10,444 |

<picture>
  <source type="image/svg+xml" media="(prefers-color-scheme: dark)" srcset="images/composition_gap-dark.svg">
  <source type="image/svg+xml" srcset="images/composition_gap-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="images/composition_gap-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="images/composition_gap-light.png">
  <img alt="Pytest pass rate, if_score and workflow pass rate for opus-5 and glm-5.3 on the 208 shared tasks; both pass far more checks than workflows" src="images/composition_gap-light.png" width="880">
</picture>

**The workflow channel decides the headline.** Because `workflow` carries exponent 0.50, it moves
`combined_score` twice as hard as either other channel, and a zero there is unrecoverable. This is
why `glm-5.3`'s rubric and pytest numbers look far better than its pass rate.

**Critical failures cluster on a few tasks.** For `opus-5`, `f5399a16` (71), `4e9d79c2` (66), `a05f9e92` (59), `a0426c74` (51) account for 247 of 3,654 critical-case failures (7%). For `glm-5.3`, `47bad8ab` (138), `4e9d79c2` (127), `ec70a373` (122), `6d707fb9` (113) account for 500 of 10,444 critical-case failures (5%). 

**The rubric is high and fairly stable.** `opus-5`'s mean `R` is 0.8384, and 24 of its 209 runs score
`R = 1.000`. Each criterion is judged three times; the three samples agree unanimously on **4,211 of
5,048** `opus-5` criteria (83.4%) and **4,033 of 4,665** `glm-5.3` criteria (86.5%, scored runs). `R` excludes the
`quality` criteria, which are reported separately (judged runs; `quality` mean 0.528 for `opus-5`, 0.309 for
`glm-5.3`) and never enter `combined_score`.

**Deploy is a cliff, not a slope.** The grader installs and builds the delivered app, starts it and
waits up to 180 s for its health path to return HTTP 200 before any test runs. A run that misses it
is recorded as `deployment-failed` with `reward = 0.0`. 14 of the 417 rollouts in this delivery failed to deploy (`001efc8f` glm-5.3, `16d8dda1` glm-5.3, `19accd6d` glm-5.3, `1c568f2d` glm-5.3, `3a79fa7f` glm-5.3, `5b2d9011` glm-5.3, `6d58f80f` glm-5.3, `77da028d` glm-5.3, `7c59c163` glm-5.3, `abdfc26d` glm-5.3, `d9719209` glm-5.3, `e3a06c1e` glm-5.3, `e7dd0ed1` glm-5.3, `ec70a373` glm-5.3); all others deployed and were scored.

## Coverage

| Axis | Distribution |
| --- | --- |
| Language | typescript 180, python 20, go 5, javascript 3, rust 1 |
| Archetype | individual 75, solo founder 72, enterprise 60, staged-rollout-ladder 1, crud 1 |
| Services | postgres 206, minio 166, mailpit 144, killbill 68, gotenberg 26, valkey 24, wiremock 22, meilisearch 14, keycloak 11, pocketbase 10, ntfy 8, rabbitmq 7, svix 7 |
| Category | Greenfield, all 209 |
| Week first delivered | week 1 25, week 2 50, week 3 70, week 4 64 |

Totals across the 209 tasks: **2,819 workflows**, **13,980 mandatory requirements**, **5,048 rubric
criteria** and **15,420 traceability rows** (one per requirement or instruction-following rule).
## Dataset structure

```
<task-uuid>/
├── task.toml                   task definition, incl. [metadata.ecr] image pins
├── instruction.md              the brief
├── traceability-matrix.csv     requirement → test / workflow / rubric coverage
├── environment/
│   ├── Dockerfile              the agent's container
│   └── docker-compose.yaml     backing services
├── solution/
│   ├── TRUTH.md                reference behaviour narrative
│   ├── app/                    reference application source + run.json
│   └── solve.sh
└── tests/
    ├── Dockerfile, docker-compose.yaml, test.sh
    └── grader/
        ├── grader.py           install, build, health gate, pytest, scoring
        ├── test_app.py, conftest.py, instrument.js
        ├── requirements.toml   requirements registry, workflows, critical cases
        ├── judge.py, judge.toml, prompt.md   LLM rubric judge
        └── instruction.md
```

`instruction.md` is the contract. `tests/grader/requirements.toml` is the registry the grader
enforces: requirements, workflows and which of their cases are critical. `traceability-matrix.csv`
maps each requirement to the tests, workflows and rubric criteria that exercise it.

**`solution/app/` ships reference application source** in every bundle
(27-352 files per task, excluding `node_modules`).

## Trajectory structure

```
run_1/
├── reward.json          reward (= pytest pass rate) plus workflow, pytest, rubric, quality, if_score, combined_score
├── final_score.json     combined_score, weights, per-channel breakdown, formula
├── workflows.json       summary + per-workflow verdicts
├── app/                 the application the agent built
├── screenshots/         judge captures, by profile: normal/, and on most runs reduced/ and touch/ (absent when the judge did not run)
├── trajectory/
│   └── trajectory.json  openhands-sdk steps + final_metrics
└── verifier/
    ├── ctrf.json        CTRF-format pytest report
    └── judge.json       per-criterion rubric verdicts, 3 samples each, with reasoning
```

The delivery carries **12,964 screenshots** across the 417 rollouts (6,977 `opus-5`, 5,987 `glm-5.3`),
captured by the judge. 402 runs have normal-profile screenshots; 364 also have touch and 220 also have
reduced-motion screenshots.

## Scoring methodology

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#2b3352','primaryTextColor':'#ffffff','primaryBorderColor':'#7a99d1','lineColor':'#7a99d1','fontFamily':'DM Sans, Roboto, Segoe UI, sans-serif'}}}%%
flowchart TD
    A[Agent builds /app] --> B{Install + build + start<br/>health path == 200<br/>within 180 s}
    B -- fail --> Z[deployment-failed<br/>reward = 0.0]
    B -- pass --> C[Run graders]
    C --> E[Pytest outcome cases<br/>P = passed / total]
    C --> F[Instruction-following cases<br/>if_score]
    C --> D[Workflows<br/>pass at ≥90% of steps<br/>and no critical failure]
    C --> J[LLM judge, 3 samples<br/>experience · source · quality]
    E --> R[reward.json: reward = P<br/>RL SIGNAL]
    D --> S[combined_score<br/>W^0.50 · P^0.25 · R^0.25]
    E --> S
    J --> S
    S --> T[REPORTED PASS RATE<br/>diagnostic, never trains]
    classDef sig fill:#2b3352,stroke:#FFD21F,stroke-width:2px,color:#ffffff
    classDef rep fill:#3a4360,stroke:#ee00ee,stroke-width:2px,color:#ffffff
    class R sig
    class S,T rep
```

### How the channels combine

`combined_score` is a **weighted geometric mean**, not a weighted average:

```
combined_score = W^0.50 · P^0.25 · R^0.25
```

- **`W`**, workflow pass rate. A workflow passes when at least 90% of its steps pass and none of its
  critical steps fail. On 339 of the 417 runs (`workflow_basis = "pytest + judge checkpoints"`), judge
  checkpoints count as workflow steps alongside pytest cases.
- **`P`**, pytest pass rate over outcome cases. Instruction-following cases are excluded from `P` and
  reported as `if_score`.
- **`R`**, the rubric: a weighted mean of the judge's `experience` and `source` criteria (weights
  5 / 3 / 1 for critically important / important / somewhat important). `quality` criteria are
  scored but excluded from `R`.

**A weak channel cannot be bought back.** Under a geometric mean the product is dragged toward its
weakest term, and a zero anywhere is a zero overall. 186 of the 186 zero-score runs in this delivery are
`W = 0` runs.

### The RL signal

`reward.json`'s `reward` is `P`, the pytest outcome pass rate, and nothing else. It is reproducible
on stock Harbor without the judge. `W`, `R`, `quality`, `if_score` and `combined_score` sit beside
it in the same file as diagnostics.

### LLM rubric

The judge runs in batched mode with **3 samples per criterion** and a Playwright MCP server restricted to browsing tools, so `experience` criteria are judged from a
live render and `source` / `quality` criteria from the delivered files (`file:line` evidence).
Each criterion in `verifier/judge.json` carries its three samples, their agreement and the judge's
reasoning.

### Oracle score

The oracle run (`harbor run -p <task-uuid> -a oracle`, whose `solution/solve.sh` copies `solution/app/` into `/app`) is the reference
solution scored by the same grader as the agents. **A score of 1.0 is deterministic only where no
LLM judge is involved:**

| Channel | Graded by | Oracle score of 1.0 |
| --- | --- | --- |
| `P`, pytest outcome cases (`reward`) | pytest | deterministic |
| `if_score`, instruction-following cases | pytest | deterministic |
| `W`, workflows built only from pytest cases | pytest | deterministic |
| `W` on tasks whose workflows include judge checkpoints | pytest + LLM judge | **not guaranteed** |
| `R`, rubric (and `quality`) | LLM judge, 3 samples | **not guaranteed** |
| `combined_score` | `W^0.50 · P^0.25 · R^0.25` | **not guaranteed** on any task, because `R` enters it |

The judge is a sampled language model. It can fail a correct reference implementation on any
rubric criterion or judge checkpoint, and the same oracle can score differently from one run to the
next. 180 tasks put judge checkpoints into their workflows (`checkpoints` in
`tests/grader/requirements.toml`): `001efc8f`, `017c1ef8`, `02f905f6`, `03ec7574`, `05439808`, `07f5444f`, `0a24efbb`, `0b297f2f`, `0d5b421c`, `1160b78d`, `14b4e0bc`, `160e307e`, `16d8dda1`, `188e98f8`, `19accd6d`, `1aa0da7f`, `1af7a951`, `1bd57c5f`, `1e363484`, `21fd03b2`, `227e831a`, `24601f10`, `266cc9d1`, `267caec2`, `26e9a8b6`, `27e5c5d1`, `2a87ee8d`, `347522e8`, `34eb8930`, `376c7c28`, `3a79fa7f`, `3b1606ee`, `3e25b869`, `3ed42748`, `410b0a62`, `450cf4b3`, `47925b4c`, `47bad8ab`, `4804911b`, `4d620ce5`, `4e567a88`, `4e75f56f`, `4e829e38`, `4e9d79c2`, `4f60dc8f`, `505ab434`, `51b6db54`, `5308e86e`, `54c4ef10`, `5559ceaa`, `58393de0`, `5b2d9011`, `5e2a947e`, `5e58bb82`, `60c53cd9`, `630a5ba0`, `634b5fff`, `63f5b422`, `645c528a`, `64cce043`, `659ff5a8`, `671c7943`, `6783ee8a`, `67d48d61`, `688485a0`, `6d58f80f`, `6d707fb9`, `7141c5af`, `740047f7`, `77da028d`, `783662f0`, `7a9f19b5`, `7c59c163`, `7c716c2d`, `7e2aa12d`, `8061ec0b`, `833c86e9`, `8694c8f3`, `88261f7f`, `89091e13`, `893ceba9`, `8a7f3e55`, `8b457374`, `8e494b6a`, `8f987bee`, `8fa5cc17`, `91afea8e`, `9371a8da`, `946a8343`, `9533ebee`, `96b27234`, `96c941d4`, `98013ee6`, `98536410`, `9b5bc422`, `9bfc9b36`, `9cc31ad2`, `9d9cc75d`, `a0426c74`, `a05f9e92`, `a0fc74b8`, `a3966622`, `a46b8d45`, `a48ecbeb`, `a634f791`, `a6e8fa11`, `a7893e48`, `a9ab5d5e`, `aabda112`, `ab3214bf`, `abdfc26d`, `add1364c`, `b3014344`, `b312aa10`, `b597bb9c`, `b6915223`, `b6f559f3`, `b76c0217`, `b8c9f8a4`, `b9ed6f48`, `ba54e903`, `bab772c1`, `bc33abaa`, `bc58b4f3`, `be6632fd`, `bec04d26`, `becc71f7`, `bf208a6c`, `bf768c0f`, `bfb67a27`, `c2102b00`, `c4542d52`, `c6b27312`, `c8622c96`, `c955fb61`, `cf669c8e`, `d09edabd`, `d14955b4`, `d21868a7`, `d298cbbd`, `d2fda3ba`, `d4519147`, `d7ccae7f`, `d7d06515`, `d86110e9`, `d9719209`, `d974eab3`, `dd026e33`, `df84b04d`, `e1a41369`, `e1d33317`, `e2a9b5bf`, `e387e0cd`, `e3a06c1e`, `e524757a`, `e6d96b37`, `e70f63d8`, `e76c8222`, `e7dd0ed1`, `e7e372c1`, `ea8a9699`, `eb62b28b`, `ec70a373`, `ecaf9927`, `ed56c586`, `eec0a822`, `f160d048`, `f37fc654`, `f3c2d550`, `f4a90c29`, `f527cbc8`, `f5399a16`, `f7780386`, `f872975f`, `f9641a08`, `fa0d1078`, `fa34a58b`, `fa58e169`, `fb5153e6`, `fe5b78f3`. On those tasks the oracle's `W` can also fall
below 1.0. On the other 29 tasks `W` is pytest-only and deterministic.

So an oracle `reward` (`P`) below 1.0 is a real defect in the task or its solution. An oracle `R`,
judge-checkpoint `W` or `combined_score` below 1.0 may be judge variance, not a fault in the
solution, and should be re-run or reviewed by a person before it is treated as one. No oracle
results are shipped in this delivery.

## Running a task

The env and tests images for every task are pinned by digest in `task.toml` under
`[metadata.ecr]`, and `[environment].docker_image` / `[verifier.environment].docker_image` point
Harbor at them, so Harbor pulls rather than builds. The repository is private; log in first:

```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin 426628337772.dkr.ecr.ap-south-1.amazonaws.com
harbor run -p <task-uuid> -a <agent>
```

Each image is a multi-arch index (`linux/amd64`, `linux/arm64`), so Docker pulls the native
variant. `harbor run --force-build` still builds the agent's environment from
`environment/Dockerfile`. Grading needs the backing services in `environment/docker-compose.yaml`
and judge credentials.
