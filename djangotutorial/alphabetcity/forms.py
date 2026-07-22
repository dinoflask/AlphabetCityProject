from django import forms
from alphabetcity.models import Question, Answer
from django.forms import Form, ModelForm, ValidationError

class LoginForm(Form):
    code = forms.CharField(label="Your code", max_length=6, min_length=6)

    def clean(self):
        cleaned_data = super().clean()
        return cleaned_data
    

class QuestionForm(forms.Form):
    pk = forms.ChoiceField(label="Question", choices=[])

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['pk'].choices = Question.objects.values_list('pk', 'question_text')

    def clean(self):
        cleaned_data = super().clean()
        return cleaned_data
        

class AnswerForm(ModelForm):

    MIN_WORDS = 10

    class Meta:
        model = Answer
        fields = ["answer_text"]

    def clean_answer_text(self):
        text = self.cleaned_data["answer_text"]
        words = len(text.split())
        if words < self.MIN_WORDS:
            raise forms.ValidationError(
                f"Please write at least {self.MIN_WORDS} words (you have {words})."
            )
        return text