from django.contrib import admin


from .models import Answer, Question, Resident

admin.site.register(Question)
admin.site.register(Answer)
admin.site.register(Resident)