"""Routes: the API under /api, the pages, static files; everything else is not found."""
from django.urls import path, re_path

from northpier import api, pages

urlpatterns = [
    path("api/health", api.health),
    path("api/auth/login", api.login),
    path("api/auth/logout", api.logout),
    path("api/me", api.me),
    path("api/cases", api.cases_list),
    path("api/cases/<str:slug>", api.case_detail),
    path("api/inquiries", api.submit_inquiry),
    path("api/inquiries/status/<str:token>", api.status_read),
    path("api/studio/inquiries", api.studio_queue),
    path("api/studio/inquiries/<str:raw_id>", api.studio_detail),
    path("api/studio/inquiries/<str:raw_id>/transition", api.transition),
    path("api/studio/inquiries/<str:raw_id>/notes", api.add_note),
    re_path(r"^api/", api.not_found),
    path("", pages.landing),
    path("work/<str:slug>", pages.case_page),
    path("services", pages.services),
    path("contact", pages.contact),
    path("start", pages.start),
    path("inquiry/<str:token>", pages.status_page),
    path("privacy-policy", pages.privacy),
    path("consent", pages.consent),
    path("studio", pages.studio_queue_page),
    path("studio/signin", pages.signin),
    path("studio/signout", pages.signout),
    path("studio/inquiries/<str:raw_id>", pages.studio_inquiry_page),
    path("static/<path:path>", pages.static_file),
    re_path(r"", pages.not_found_page),
]
