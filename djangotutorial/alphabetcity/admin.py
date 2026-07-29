from django.contrib import admin


from .models import Answer, Question, Resident


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    # "visible" is editable right from the list so answers can be shown/hidden
    # on the Index wall in one click.
    list_display = ("id", "question", "short_text", "resident_code", "visible", "pub_date")
    list_editable = ("visible",)
    list_filter = ("visible", "question")
    search_fields = ("answer_text",)
    list_per_page = 50

    @admin.display(description="Answer")
    def short_text(self, obj):
        return (obj.answer_text[:60] + "…") if len(obj.answer_text) > 60 else obj.answer_text

    @admin.display(description="Code")
    def resident_code(self, obj):
        return obj.resident.code if obj.resident else "—"


admin.site.register(Question)
admin.site.register(Resident)
