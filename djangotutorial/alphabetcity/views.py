from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render
from django.http import HttpResponse
from alphabetcity.forms import AnswerForm, LoginForm
from alphabetcity.models import Question, Answer, Resident


#Sessions: Create session on this request
#Next: Time people out

def welcome(request):
    return render(request, "alphabetcity/welcome.html")


def login(request):

    if request.method == "POST":
        form = LoginForm(request.POST)
        if form.is_valid():
            try:
                resident = get_object_or_404(Resident, code=form.cleaned_data['code'])
                request.session["resident_id"] = resident.id
            except:
                messages.error(request, "Code does not exist. Try Again!")
                return redirect('login')
            
            return redirect('choose')
    else:
        form = LoginForm()

    return render(request, "alphabetcity/code.html", {"form": form})


def index(request):
    all_answers_list = Answer.objects.order_by("-pub_date")
    context = {"all_answers_list": all_answers_list}
    return render(request, "alphabetcity/index.html", context)

# Pre-Answer

def choose_question(request):
    #Sessions: Check if this request has a session attached
    resident_id = request.session.get('resident_id')
    if not resident_id:
        messages.error(request, "Sign in with your code first!")
        return redirect('login')

    # The Choose page lets the resident click a question directly (each links to
    # its Answer page), so no form round-trip is needed here.
    questions = Question.objects.all().order_by("pk")
    return render(request, "alphabetcity/choose.html", {"questions": questions})

def answer_question(request, question_pk):
    #Sessions: Check if this request has a session attached
    resident_id = request.session.get('resident_id')
    if not resident_id:
        messages.error(request, "Sign in with your code first!")
        return redirect('login')

    resident = Resident.objects.get(pk=resident_id)
    question = get_object_or_404(Question, pk=question_pk)
    if request.method == "POST":
        form = AnswerForm(request.POST)
        if form.is_valid():
            Answer.objects.create(
                resident=resident, #Sessions: This question now definitely has a resident attached
                question=question,  # Use the question fetched from the URL
                answer_text=form.cleaned_data['answer_text'],
            )
            return redirect('index')
    else:
        form = AnswerForm() 
    return render(request, "answer.html", {"form": form, "question": question})

# Post-Answer
def detail_answer(request, answer_id):
    answer = get_object_or_404(Answer, pk=answer_id)
    return render(request, "detail.html", {"answer": answer})

def edit_answer(request, answer_id):
    a = get_object_or_404(Answer, id=answer_id)
    resident_id = request.session.get('resident_id')
    if not resident_id or a.resident.id != resident_id:
        messages.error(request, "Can't edit another person's post!")
        return redirect('detail', answer_id=answer_id)

    if request.method == "POST":
        form = AnswerForm(request.POST, instance=a)
        if form.is_valid():
            form.save()
            return redirect('detail', answer_id=a.id)
    else:
        form = AnswerForm(instance=a) # Populates form with existing data
        
    return render(request, 'edit.html', {'form': form, 'answer_id': a.id})


def delete_answer(request, answer_id):
    response = "You're deleting question %s."
    return HttpResponse(response % answer_id)