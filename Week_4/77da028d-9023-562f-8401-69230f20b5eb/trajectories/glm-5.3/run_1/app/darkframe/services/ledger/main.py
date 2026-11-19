"""Ledger service entrypoint: routes on 127.0.0.1:<public port + 200>."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from starlette.routing import Route

from darkframe.common.db import Database
from darkframe.common.http import build_app
from darkframe.services.ledger import api as ledger_api
from darkframe.services.ledger import calibration, frames, projects, sessions
from darkframe.services.ledger.storage import init_storage

VERSION = "1.0.0"


def routes() -> list[Route]:
    return [
        Route("/internal/health", health, methods=["GET"]),
        Route("/projects", projects.list_projects, methods=["GET"]),
        Route("/projects", projects.create_project, methods=["POST"]),
        Route("/projects/{project_id}", projects.get_project, methods=["GET"]),
        Route("/projects/{project_id}", projects.patch_project, methods=["PATCH"]),
        Route("/projects/{project_id}/transition", projects.transition_project, methods=["POST"]),
        Route("/projects/{project_id}/allotments/{filter}", projects.put_allotment, methods=["PUT"]),
        Route("/projects/{project_id}/ledger", projects.get_ledger, methods=["GET"]),
        Route("/projects/{project_id}/share", projects.create_share, methods=["POST"]),
        Route("/projects/{project_id}/share", projects.get_share, methods=["GET"]),
        Route("/projects/{project_id}/share", projects.revoke_share, methods=["DELETE"]),
        Route("/shared/{token}", projects.shared_body, methods=["GET"]),
        Route("/sessions", sessions.list_sessions, methods=["GET"]),
        Route("/sessions", sessions.create_session, methods=["POST"]),
        Route("/sessions/{session_id}", sessions.get_session, methods=["GET"]),
        Route("/sessions/{session_id}/start", sessions.start_session, methods=["POST"]),
        Route("/sessions/{session_id}/batches", sessions_batches, methods=["POST"]),
        Route("/sessions/{session_id}/log", sessions.log_session, methods=["POST"]),
        Route("/sessions/{session_id}/amend", sessions.amend_session, methods=["POST"]),
        Route("/sessions/{session_id}/trash", sessions.trash_session, methods=["POST"]),
        Route("/sessions/{session_id}/restore", sessions.restore_session, methods=["POST"]),
        Route("/sessions/{session_id}/lock", frames.take_lock, methods=["POST"]),
        Route("/sessions/{session_id}/lock", frames.release_lock, methods=["DELETE"]),
        Route("/sessions/{session_id}/notes", frames.save_notes, methods=["PATCH"]),
        Route("/batches/{batch_id}/frames/{name}", frames.upload_frame, methods=["PUT"]),
        Route("/frames/{frame_id}/content", frames.download_frame, methods=["GET"]),
        Route("/batches/{batch_id}/calibration-candidates", calibration.calibration_candidates, methods=["GET"]),
        Route("/batches/{batch_id}/calibration", calibration.link_calibration, methods=["POST"]),
        Route("/batches/{batch_id}/calibration/{kind}", calibration.unlink_calibration, methods=["DELETE"]),
        Route("/calibration-sets", calibration.list_sets, methods=["GET"]),
        Route("/calibration-sets", calibration.create_set, methods=["POST"]),
        Route("/calibration-sets/{set_id}", calibration.get_set, methods=["GET"]),
        Route("/calibration-sets/{set_id}", calibration.patch_set, methods=["PATCH"]),
        Route("/calibration-sets/{set_id}/master", calibration.upload_master, methods=["PUT"]),
        Route("/calibration-sets/{set_id}/master", calibration.download_master, methods=["GET"]),
        Route("/calibration-sets/{set_id}/transition", calibration.transition_set, methods=["POST"]),
        Route("/calibration-sets/{set_id}/versions", calibration.list_versions, methods=["GET"]),
        Route("/calibration-sets/{set_id}/restore", calibration.restore_version, methods=["POST"]),
    ]


async def health(request):
    from starlette.responses import JSONResponse

    return JSONResponse({"name": "ledger", "version": VERSION, "status": "ok"})


async def sessions_batches(request):
    from darkframe.services.ledger import batches as batches_mod

    return await batches_mod.add_batch(request)


def create_app():
    url = os.environ["DATABASE_URL"]

    @asynccontextmanager
    async def lifespan(app):
        ledger_api.DB = Database(url, "ledger")
        ledger_api.DB.ensure_schema()
        init_storage(
            os.environ.get("S3_ENDPOINT", "http://127.0.0.1:9000"),
            os.environ.get("S3_ACCESS_KEY_ID", ""),
            os.environ.get("S3_SECRET_ACCESS_KEY", ""),
            os.environ.get("S3_BUCKET", "darkframe"),
            os.environ.get("S3_REGION", "us-east-1"),
        )
        yield
        ledger_api.DB.close()

    return build_app(routes(), "ledger", lifespan=lifespan)


def serve() -> None:
    import uvicorn

    from darkframe.config import load_config

    config = load_config()
    uvicorn.run(create_app(), host="127.0.0.1", port=config.ledger_port, log_level="warning")
