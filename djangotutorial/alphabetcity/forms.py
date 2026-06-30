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

    class Meta:
        model = Answer
        fields = ["answer_text"]

    def clean_question_pk(self):
        pk = self.cleaned_data['question_pk']
        if not Question.objects.filter(pk=pk).exists():
            raise forms.ValidationError("Invalid question.")
        return pk