from django.urls import path
from . import views


urlpatterns = [

    # ex: /alphabetcity/  (landing / Welcome frame)
    path("", views.welcome, name="welcome"),

    # Pre-Answer
    # ex: /alphabetcity/login/  (Code frame)
    path("login/", views.login, name="login"),
    # ex: /alphabetcity/index/  (answers wall)
    path("index/", views.index, name="index"),
    # ex: /alphabetcity/5/
    path("detail/<int:answer_id>/", views.detail_answer, name="detail"),
    # ex: /alphabetcity/choose/
    path("choose/", views.choose_question, name="choose"),
    # ex: /alphabetcity/answer/2
    path("answer/<int:question_pk>/", views.answer_question, name="answer"),

    # Post-Answer

    # ex: /alphabetcity/edit/5
    path("edit/<int:answer_id>/", views.edit_answer, name="edit"),
    # ex: /alphabetcity/delete/5
    path("delete/<int:answer_id>/", views.delete_answer, name="delete"),
    
]