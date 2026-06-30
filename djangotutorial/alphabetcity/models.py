from django.db import models
from django.contrib.auth.models import AbstractUser

# class CustomUser(AbstractUser):
#     # Add any extra fields your application needs here
#     code = models.IntegerField()

class Question(models.Model):
    question_text = models.CharField(max_length=10000)

    def __str__(self):
        return self.question_text

    
class Resident(models.Model):
    code = models.CharField(max_length=6, unique=True, null=True)
    # nothing else identifying

class Answer(models.Model):
    resident = models.ForeignKey(Resident, on_delete=models.CASCADE, null=True) #Can be not assigned to a person, for now
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
    answer_text = models.CharField(max_length=10000)
    pub_date = models.DateTimeField("date published", auto_now_add=True)

    def __str__(self):
        return self.answer_text


