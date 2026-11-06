<p align="center">
  <picture>
    <source type="image/svg+xml" srcset="../images/hero.svg">
    <img src="../images/hero.png" alt="Greenfield: from a prose brief and an empty /app to a working app, graded in a live browser" width="880">
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
  <a href="#summary">Summary</a> · <a href="#whats-in-week-2">Week 2</a> · <a href="#repository-layout">Layout</a> · <a href="#difficulty-tiers">Tiers</a> · <a href="#results">Results</a> · <a href="#analysis">Analysis</a> · <a href="#coverage">Coverage</a> · <a href="#dataset-structure">Dataset</a> · <a href="#trajectory-structure">Trajectories</a> · <a href="#scoring-methodology">Scoring</a> · <a href="#running-a-task">Running</a>
</sub></p>

# Greenfield: Application Build Delivery — Week 2

**Greenfield measures whether a coding agent can turn a prose product brief into a deployed,
working web application that a stranger can drive in a browser.**

Each task hands an agent a long-form product specification, an empty `/app` and a service stack
(PostgreSQL on almost every task, plus any of Mailpit, MinIO, Kill Bill, Keycloak, PocketBase and others), and asks it to ship
something that installs, builds, answers a health probe and survives the task's own pytest suite,
workflow checks and an LLM rubric that drives a real browser. There is no repository to patch and no
oracle diff to approximate.

This delivery is **broad and shallow: 75 tasks, 146 graded rollouts.** Every task carries one
`opus-5` run; 71 of the 75 also carry one `glm-5.3` run. With one run per task per model, every
per-task number here is **a single observation, not a rate**, and the two cohorts are only directly
comparable on the 71 tasks they share.

**Not one of the 146 rollouts passed every workflow.** Throughout this document **pass rate is
`combined_score`** from `final_score.json`, as a percentage, averaged over runs where more than one
is pooled:

```
combined_score = workflow^0.50 · pytest^0.25 · rubric^0.25
```

It is a partial-credit, geometric measure: one channel at zero takes the whole product to zero. This
is **not pass@k**.

> **Oracle score disclaimer.** The reference solution is guaranteed a score of 1.0 only on the
> deterministic channels (pytest). Wherever the LLM judge is involved, in the rubric on every task and
> in the workflows of 53 tasks, a perfect oracle score is not guaranteed. See
> [Oracle score](#oracle-score).

## Summary

| Property | Value |
| --- | --- |
| Tasks | 75 (25 from week 1, 50 new) |
| Models | `opus-5` (75 runs), `glm-5.3` (71 runs) |
| Runs per task per model | 1 |
| Graded rollouts | 146; 145 with `judge = "scored"`, 1 `deployment-failed` |
| Languages | TypeScript (62), Python (9), JavaScript (3), Go (1) |
| Agent harness | `openhands-sdk` on Harbor 0.24.0 |
| Grader | `rewardkit-0.2.3`, LLM judge, 3 samples per criterion |
| Reward signal | pytest outcome pass rate, `reward.json` |

Across all 146 rollouts the corpus pass rate is **27.66%** (σ 0.2454, range 0.000-0.825). That
number mixes two cohorts and should not be quoted on its own.

**`opus-5` beats `glm-5.3` on 70 of 71 shared tasks** (`glm-5.3` wins `e76c8222`), by 35.46 points on average (largest gap 80.03
points on `acf3d1b6`).

Two numbers travel together throughout and must not be confused. **Pass rate is `combined_score`**,
the headline measure of how much of a task the agent actually delivered. **`reward.json` carries
`reward`, the pytest outcome pass rate alone**, and it is the only number that trains anything;
the grader labels `combined_score` a diagnostic.

## What's in week 2

- **25 tasks from the week-1 delivery** (`kiro-greenfield`), unchanged except that `glm-5.3` runs were added
  for `1bc089d6`, `3ed42748`, `5559ceaa`, `7a50c331`, `c8622c96` and the author lists of four tasks were updated.
- **50 new tasks** from Stage 2. Before delivery their trajectories were checked for leaked provider
  ids (redacted to `[REDACTED]`), every `task.toml` loads in Harbor 0.24 and validates against its schema, and
  `grader.py validate` passes on every bundle.
- **4 tasks still carry `opus-5` only:** `065a9171`, `1c568f2d`, `3a79fa7f`, `a6e8fa11`.

## Repository layout

```
week-2/
├── README.md                 # this document
└── <uuid>/                   # one self-contained directory per task (75)
    ├── task.toml, instruction.md, traceability-matrix.csv
    ├── environment/, solution/, tests/
    └── trajectories/
        ├── opus-5/run_1
        └── glm-5.3/run_1     # 71 of 75 tasks
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

| tier | tasks on `opus-5` | tasks on `glm-5.3` (71) |
|---|--:|--:|
| `trivial` | 0 | 0 |
| `easy` | 20 | 4 |
| `medium` | 33 | 2 |
| `hard` | 11 | 5 |
| `expert` | 11 | 60 |

The two models put a task in the same band on **15 of 71** shared tasks. With one run per task,
a tier here is one draw, not a measured rate: a task one run away from a band edge could land in the
neighbouring band on a re-run. Treat these tiers as provisional until each task has repeated runs.

## Results

### Pass rate by task and model

Sorted by `opus-5`. `W` is workflows passed / total, `P` the pytest outcome pass rate, `R` the rubric
score. `—` means the task has no `glm-5.3` run; `wk` is the week the task was first delivered.

| Task | wk | `opus-5` | W | P | R | `glm-5.3` | W | P | R |
| --- | :-: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `a6e8fa11` furrowbook | 1 | 82.46% | 10/13 | 0.944 | 0.828 | — | | | |
| `dd09740b` agency-inquiry-desk | 2 | 81.07% | 11/14 | 0.973 | 0.719 | 37.11% | 3/14 | 0.735 | 0.562 |
| `acf3d1b6` video-credit-studio | 1 | 80.03% | 5/7 | 0.933 | 0.862 | 0.00% | 0/7 | 0.756 | 0.862 |
| `a8936445` stationkeeper | 1 | 78.07% | 10/14 | 0.921 | 0.790 | 59.53% | 6/14 | 0.865 | 0.790 |
| `f9ef9fe2` pilotlight | 1 | 76.55% | 8/13 | 0.907 | 1.000 | 50.06% | 5/13 | 0.733 | 0.579 |
| `cc20dbf3` shedline | 1 | 75.37% | 9/13 | 0.930 | 0.724 | 22.79% | 1/13 | 0.630 | 0.724 |
| `d2fda3ba` cairn-field-notebook | 2 | 74.02% | 7/12 | 0.882 | 1.000 | 0.00% | 0/12 | 0.441 | 0.203 |
| `f0ef5446` partner-program-intake | 2 | 73.25% | 5/9 | 0.933 | 1.000 | 0.00% | 0/9 | 0.732 | 0.860 |
| `0fe016e0` feature-flag-rollout-ladder | 1 | 73.03% | 4/7 | 0.871 | 1.000 | 0.00% | 0/7 | 0.452 | 0.145 |
| `1bc089d6` stillhour | 1 | 72.18% | 7/12 | 0.926 | 0.862 | 0.00% | 0/12 | 0.638 | 0.569 |
| `03ec7574` treasury-quorum-console | 1 | 66.26% | 10/18 | 0.843 | 0.741 | 61.19% | 9/18 | 0.757 | 0.741 |
| `f7780386` passboard | 1 | 65.57% | 6/12 | 0.880 | 0.841 | 22.61% | 1/12 | 0.590 | 0.638 |
| `bc58b4f3` teamseat | 2 | 64.85% | 5/10 | 0.860 | 0.823 | 0.00% | 0/10 | 0.495 | 0.871 |
| `8f4910c6` rungboard | 2 | 62.14% | 6/13 | 0.843 | 0.831 | 0.00% | 0/13 | 0.236 | 0.864 |
| `1c568f2d` exhibit-clearance-desk | 1 | 60.86% | 5/11 | 0.841 | 0.789 | — | | | |
| `065a9171` tallow-cover | 1 | 55.62% | 5/14 | 0.793 | 0.946 | — | | | |
| `09ede887` conference-workshop-booking-vb | 2 | 54.94% | 3/9 | 0.820 | 1.000 | 51.34% | 3/9 | 0.739 | 0.846 |
| `107eb6d6` tour-freight-desk | 1 | 54.59% | 4/11 | 0.771 | 0.871 | 37.98% | 2/11 | 0.723 | 0.871 |
| `c8622c96` saltprint-desk | 1 | 51.54% | 5/14 | 0.830 | 0.667 | 0.00% | 0/14 | 0.420 | 0.228 |
| `3a79fa7f` efoil-build-checkout-vb | 1 | 51.40% | 5/15 | 0.868 | 0.724 | — | | | |
| `b3014344` pampero-build-ledger | 2 | 49.56% | 4/14 | 0.835 | 0.886 | 0.00% | 0/14 | 0.551 | 0.629 |
| `76b76d2d` halide-box-office | 2 | 49.40% | 5/15 | 0.673 | 0.797 | 0.00% | 0/15 | 0.575 | 0.750 |
| `0a24efbb` attendance-regularisation-desk | 2 | 48.86% | 3/11 | 0.833 | 0.919 | 26.19% | 1/11 | 0.706 | 0.806 |
| `5306a075` loomwise-evidence-desk | 1 | 48.84% | 4/13 | 0.758 | 0.793 | 0.00% | 0/13 | 0.439 | 0.741 |
| `be6632fd` hourline | 2 | 48.37% | 4/13 | 0.819 | 0.706 | 0.00% | 0/13 | 0.324 | 0.500 |
| `fa34a58b` nightplan-hub | 2 | 47.84% | 3/11 | 0.742 | 0.948 | 0.00% | 0/11 | 0.212 | 0.517 |
| `1e363484` fluxseal | 2 | 47.53% | 3/11 | 0.889 | 0.772 | 22.91% | 1/11 | 0.543 | 0.614 |
| `d4519147` scopewright | 2 | 47.37% | 3/12 | 0.902 | 0.893 | 0.00% | 0/12 | 0.719 | 0.804 |
| `14b4e0bc` strata-catalog | 2 | 47.19% | 4/15 | 0.811 | 0.860 | 0.00% | 0/15 | 0.358 | 0.632 |
| `7c716c2d` tallyroom | 2 | 47.11% | 4/14 | 0.763 | 0.790 | 0.00% | 0/14 | 0.226 | 0.742 |
| `a7893e48` hearthshift | 1 | 46.62% | 3/12 | 0.825 | 0.917 | 0.00% | 0/12 | 0.577 | 0.183 |
| `66a9444b` kerf-frequencies | 1 | 46.40% | 3/12 | 0.785 | 0.944 | 0.00% | 0/12 | 0.194 | 0.704 |
| `941822d9` credwell | 1 | 45.73% | 3/13 | 0.821 | 1.000 | 0.00% | 0/13 | 0.095 | 0.448 |
| `cf669c8e` ommezwaai-feeler | 2 | 44.82% | 5/17 | 0.655 | 0.712 | 0.00% | 0/17 | 0.262 | 0.411 |
| `8061ec0b` bellroll | 2 | 44.45% | 3/13 | 0.800 | 0.917 | 0.00% | 0/13 | 0.090 | 0.750 |
| `0b297f2f` hangline | 2 | 44.13% | 3/13 | 0.872 | 0.817 | 0.00% | 0/13 | 0.414 | 0.633 |
| `05439808` saltreach | 2 | 43.96% | 3/12 | 0.861 | 0.694 | 24.04% | 1/12 | 0.693 | 0.694 |
| `4e567a88` lumenfold-dispatch | 2 | 43.65% | 3/12 | 0.779 | 0.746 | 0.00% | 0/12 | 0.500 | 0.600 |
| `fe5b78f3` pakka-berth | 2 | 43.52% | 3/12 | 0.769 | 0.746 | 20.39% | 1/12 | 0.490 | 0.508 |
| `3e25b869` loafline | 2 | 43.12% | 3/13 | 0.708 | 0.917 | 0.00% | 0/13 | 0.194 | 0.783 |
| `d5bda8ea` community-event-rsvp-vb | 2 | 42.75% | 3/14 | 0.811 | 0.897 | 41.44% | 3/14 | 0.792 | 0.810 |
| `1aa0da7f` wardline | 2 | 42.48% | 3/14 | 0.741 | 0.957 | 0.00% | 0/14 | 0.224 | 0.362 |
| `eec0a822` tidewright | 2 | 42.47% | 3/13 | 0.747 | 0.818 | 0.00% | 0/13 | 0.133 | 0.654 |
| `4e75f56f` opaline-bench-days | 2 | 42.26% | 3/14 | 0.769 | 0.903 | 0.00% | 0/14 | 0.323 | 0.774 |
| `5e58bb82` swathdeck | 2 | 41.76% | 5/22 | 0.745 | 0.790 | 35.83% | 5/22 | 0.520 | 0.613 |
| `e7dd0ed1` farshore-console | 2 | 41.73% | 4/18 | 0.732 | 0.838 | 0.00% † | 0/18 | 0.000 | 0.000 |
| `1bd57c5f` snaglight-walkthrough | 2 | 39.66% | 4/19 | 0.744 | 0.750 | 0.00% | 0/19 | 0.233 | 0.804 |
| `376c7c28` stackfire-kiln-desk | 2 | 39.64% | 2/11 | 0.816 | 0.915 | 24.92% | 1/11 | 0.671 | 0.695 |
| `347522e8` railside | 2 | 39.51% | 3/14 | 0.750 | 0.708 | 16.66% | 1/14 | 0.317 | 0.477 |
| `a48ecbeb` ceibo-sparkling-mate | 2 | 38.64% | 2/12 | 0.803 | 1.000 | 0.00% | 0/12 | 0.224 | 0.097 |
| `bcf42373` cinematic-developer-casebook-vb | 1 | 38.38% | 2/11 | 0.791 | 0.831 | 25.41% | 1/11 | 0.744 | 0.678 |
| `15996f31` swarmline-bloom-desk | 1 | 37.53% | 2/11 | 0.600 | 1.000 | 0.00% | 0/11 | 0.383 | 0.844 |
| `e7e372c1` tracewell-treasury-record | 2 | 37.51% | 2/12 | 0.775 | 0.919 | 0.00% | 0/12 | 0.050 | 0.919 |
| `67d48d61` promptside | 2 | 37.01% | 2/13 | 0.888 | 0.893 | 0.00% | 0/13 | 0.533 | 0.768 |
| `9b5bc422` oddment | 2 | 36.66% | 2/13 | 0.833 | 0.915 | 0.00% | 0/13 | 0.333 | 0.864 |
| `3ed42748` parcel-moon | 1 | 36.52% | 2/13 | 0.830 | 0.906 | 0.00% | 0/13 | 0.557 | 0.500 |
| `659ff5a8` conecount-paddock | 2 | 35.47% | 2/13 | 0.836 | 0.800 | 0.00% | 0/13 | 0.060 | 0.691 |
| `dd026e33` lacquer-motor-house | 2 | 35.06% | 2/12 | 0.688 | 0.790 | 0.00% | 0/12 | 0.172 | 0.710 |
| `fb5153e6` turnstone-studio | 2 | 32.08% | 2/13 | 0.575 | 0.778 | 0.00% | 0/13 | 0.315 | 0.746 |
| `c2102b00` tally-split | 2 | 30.47% | 2/18 | 0.805 | 0.867 | 0.00% | 0/18 | 0.283 | 0.583 |
| `f527cbc8` clinchline | 2 | 27.62% | 3/24 | 0.678 | 0.549 | 0.00% | 0/24 | 0.261 | 0.231 |
| `5559ceaa` relay-bench | 1 | 27.39% | 1/11 | 0.750 | 0.907 | 0.00% | 0/11 | 0.619 | 0.704 |
| `54c4ef10` edgeprint | 2 | 26.69% | 1/12 | 0.800 | 0.914 | 0.00% | 0/12 | 0.012 | 0.190 |
| `e387e0cd` lanternline | 2 | 25.77% | 1/13 | 0.811 | 0.919 | 21.42% | 1/13 | 0.432 | 0.823 |
| `e76c8222` seatweaver | 2 | 24.95% | 1/12 | 0.681 | 0.820 | 33.34% | 2/12 | 0.565 | 0.787 |
| `34eb8930` quillmere-drafts | 2 | 24.91% | 1/13 | 0.687 | 0.948 | 0.00% | 0/13 | 0.418 | 0.707 |
| `7a50c331` governed-context-graph | 1 | 24.77% | 3/23 | 0.636 | 0.348 | 0.00% | 0/23 | 0.172 | 0.826 |
| `b312aa10` lineboard | 2 | 24.12% | 1/14 | 0.798 | 0.831 | 0.00% | 0/14 | 0.505 | 0.644 |
| `63f5b422` plinth-site-builder | 2 | 24.07% | 1/13 | 0.649 | 0.873 | 0.00% | 0/13 | 0.117 | 0.825 |
| `bc33abaa` orrery-studio | 1 | 23.31% | 1/14 | 0.708 | 0.817 | 0.00% | 0/14 | 0.333 | 0.733 |
| `7a9f19b5` southerly-lightfall | 2 | 23.24% | 1/14 | 0.667 | 0.857 | 0.00% | 0/14 | 0.389 | 0.714 |
| `8fa5cc17` quire-commonplace | 2 | 21.88% | 1/15 | 0.565 | 0.914 | 0.00% | 0/15 | 0.324 | 0.724 |
| `783662f0` plotwright | 2 | 20.07% | 1/18 | 0.575 | 0.914 | 0.00% | 0/18 | 0.345 | 0.466 |
| `63bcee2d` plumbline | 1 | 18.08% | 1/13 | 0.181 | 1.000 | 0.00% | 0/13 | 0.056 | 0.381 |
| `f5399a16` clapstick-desk | 2 | 16.12% | 1/19 | 0.349 | 0.700 | 0.00% | 0/19 | 0.101 | 0.157 |

† `deployment-failed`: the app did not pass the health gate, so the run is scored 0 and its rubric is not judged (`e7dd0ed1` glm-5.3).

**`f5399a16` clapstick-desk is the lowest `opus-5` task** at 16.12%; **`a6e8fa11` furrowbook is the highest** at 82.46%
(10 of 13 workflows). `opus-5` scores zero on 0 of 75 tasks; `glm-5.3` on 52 of 71.

### Model comparison (71 shared tasks)

| | `opus-5` | `glm-5.3` | Δ |
| --- | ---: | ---: | ---: |
| Pass rate | 44.40% | 8.95% | -35.46 |
| Reward (pytest) | 77.24% | 41.72% | -35.52 |
| Workflows passed | 25.68% | 5.03% | -20.65 |
| Rubric `R` | 0.8463 | 0.6240 | -0.2223 |
| Tasks won | 70 | 1 | |

**Most `glm-5.3` zeros are workflow zeros.** 52 of its 52 zero-score runs passed no workflow, so
`workflow^0.50` is 0 and the product collapses even where pytest and rubric are above zero.

With n = 1 per task, no single-task gap can be separated from run-to-run noise.

## Analysis

**Check accuracy does not survive composition.** A workflow passes only when at least 90% of its steps pass **and** none of its
critical steps fail (`grader.py`: `passed * 10 >= total * 9 and not critical_failed`), so partial
competence collapses at the join.

| Channel (71 shared tasks) | `opus-5` | `glm-5.3` |
| --- | ---: | ---: |
| Workflows | 245 / 954 (25.68%) | 48 / 954 (5.03%) |
| Pytest outcome cases | 5,077 / 6,534 (77.70%) | 2,818 / 6,534 (43.13%) |
| `if_score` (instruction-following cases), mean | 0.9245 | 0.8262 |
| Critical-case failures | 1,030 | 2,500 |

**The workflow channel decides the headline.** Because `workflow` carries exponent 0.50, it moves
`combined_score` twice as hard as either other channel, and a zero there is unrecoverable.

**Critical failures cluster on a few tasks.** For `opus-5`, `f5399a16` (71), `63bcee2d` (39), `783662f0` (38), `f527cbc8` (32) account for
180 of 1,063 critical-case failures (17%). For `glm-5.3`, `f5399a16` (98), `f527cbc8` (68), `8061ec0b` (66), `e7dd0ed1` (66)
account for 298 of 2,500 (12%).

**The rubric is high and fairly stable.** `opus-5`'s mean `R` is 0.8450, and 9 of its 75 runs score
`R = 1.000`. Each criterion is judged three times; the three samples agree unanimously on **1,404 of
1,740** `opus-5` criteria (80.7%) and **1,410 of 1,625** `glm-5.3` criteria (86.8%). `R` excludes the
`quality` criteria, which are reported separately (`quality` mean 0.535 for `opus-5`, 0.345 for
`glm-5.3`) and never enter `combined_score`.

**Deploy is a cliff, not a slope.** The grader installs and builds the delivered app, starts it and
waits up to 180 s for its health path to return HTTP 200 before any test runs. A run that misses it
is recorded as `deployment-failed` with `reward = 0.0`. 1 of the 146 rollouts in this delivery failed to deploy (`e7dd0ed1` glm-5.3); all others deployed and were scored.

## Coverage

| Axis | Distribution |
| --- | --- |
| Language | typescript 62, python 9, javascript 3, go 1 |
| Archetype | enterprise 32, solo founder 27, individual 14, staged-rollout-ladder 1, crud 1 |
| Services | postgres 74, mailpit 61, minio 57, killbill 39, pocketbase 6, keycloak 3, gotenberg 2, wiremock 2, meilisearch 1 |
| Category | Greenfield, all 75 |

Totals across the 75 tasks: **1,007 workflows**, **5,012 mandatory requirements**, **1,740 rubric
criteria** and **5,522 traceability rows**.

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
(27-304 files per task, excluding `node_modules`).

## Trajectory structure

```
run_1/
├── reward.json          reward (= pytest pass rate) plus workflow, pytest, rubric, quality, if_score, combined_score
├── final_score.json     combined_score, weights, per-channel breakdown, formula
├── workflows.json       summary + per-workflow verdicts
├── app/                 the application the agent built
├── screenshots/         judge captures, by profile: normal/, and on most runs reduced/ and touch/
├── trajectory/
│   └── trajectory.json  openhands-sdk steps + final_metrics
└── verifier/
    ├── ctrf.json        CTRF-format pytest report
    └── judge.json       per-criterion rubric verdicts, 3 samples each, with reasoning
```

The delivery carries **4,691 screenshots** across the 146 rollouts (2,490 `opus-5`, 2,201 `glm-5.3`),
captured by the judge. 145 runs have a normal profile; 136 also have touch and 100 also have
reduced motion.

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
  critical steps fail. On 95 of the 146 runs (`workflow_basis = "pytest + judge checkpoints"`), judge
  checkpoints count as workflow steps alongside pytest cases.
- **`P`**, pytest pass rate over outcome cases. Instruction-following cases are excluded from `P` and
  reported as `if_score`.
- **`R`**, the rubric: a weighted mean of the judge's `experience` and `source` criteria (weights
  5 / 3 / 1 for critically important / important / somewhat important). `quality` criteria are
  scored but excluded from `R`.

**A weak channel cannot be bought back.** Under a geometric mean the product is dragged toward its
weakest term, and a zero anywhere is a zero overall. 52 of the 52 zero-score runs in this delivery are
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
next. 53 tasks put judge checkpoints into their workflows (`checkpoints` in
`tests/grader/requirements.toml`): `03ec7574`, `05439808`, `0a24efbb`, `0b297f2f`, `14b4e0bc`, `1aa0da7f`, `1bd57c5f`, `1e363484`, `347522e8`, `34eb8930`, `376c7c28`, `3a79fa7f`, `3e25b869`, `3ed42748`, `4e567a88`, `4e75f56f`, `54c4ef10`, `5559ceaa`, `5e58bb82`, `63f5b422`, `659ff5a8`, `67d48d61`, `783662f0`, `7a9f19b5`, `7c716c2d`, `8061ec0b`, `8fa5cc17`, `9b5bc422`, `a48ecbeb`, `a6e8fa11`, `a7893e48`, `b3014344`, `b312aa10`, `bc33abaa`, `bc58b4f3`, `be6632fd`, `c2102b00`, `c8622c96`, `cf669c8e`, `d2fda3ba`, `d4519147`, `dd026e33`, `e387e0cd`, `e76c8222`, `e7dd0ed1`, `e7e372c1`, `eec0a822`, `f527cbc8`, `f5399a16`, `f7780386`, `fa34a58b`, `fb5153e6`, `fe5b78f3`. On those tasks the oracle's `W` can also fall
below 1.0. On the other 22 tasks `W` is pytest-only and deterministic.

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
