import time

from django.contrib import messages
from django.core.cache import cache
from django.shortcuts import get_object_or_404, redirect, render
from django.http import HttpResponse
from django.urls import reverse
from alphabetcity.forms import AnswerForm, LoginForm
from alphabetcity.models import Question, Answer, Resident


# Brute-force protection for the code page: 3 wrong guesses from the same IP
# trigger a guaranteed 5-minute lockout, timed from that 3rd wrong guess.
LOGIN_FAIL_LIMIT = 3
LOGIN_LOCKOUT_SECONDS = 300
VETTED_DEMO_CODE = "ZSHF77"


def _is_vetted_demo_resident(resident):
    if not resident:
        return False
    return (resident.code or "").strip().upper() == VETTED_DEMO_CODE


def welcome(request):
    return render(request, "alphabetcity/welcome.html")


def _humanize(seconds):
    """'4 minutes 30 seconds' style wait text from a seconds count."""
    m, s = divmod(max(0, int(seconds)), 60)
    if m and s:
        return f"{m} minute{'s' if m != 1 else ''} {s} second{'s' if s != 1 else ''}"
    if m:
        return f"{m} minute{'s' if m != 1 else ''}"
    return f"{s} second{'s' if s != 1 else ''}"


def _client_ip(request):
    """Best-effort client IP: the first X-Forwarded-For hop when behind a proxy
    (as on DigitalOcean), otherwise the direct peer address."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _session_resident(request):
    """The Resident signed in on this session, or None."""
    rid = request.session.get("resident_id")
    if not rid:
        return None
    return Resident.objects.filter(pk=rid).first()


def _owns_answer(resident, answer):
    """True only when the signed-in resident's code matches the answer owner's
    code. Ownership is keyed on the code (case-insensitively) so no one can edit
    or delete a response that isn't theirs. The vetted demo code never owns
    anything, since it's a shared code and its answers shouldn't be editable."""
    if not resident or not answer.resident_id:
        return False
    if _is_vetted_demo_resident(resident):
        return False
    owner_code = (answer.resident.code or "").strip().upper()
    my_code = (resident.code or "").strip().upper()
    return bool(owner_code) and owner_code == my_code

def login(request):
    if request.method == "POST":
        ip = _client_ip(request)
        lock_key = f"login_lockout:{ip}"
        attempts_key = f"login_attempts:{ip}"

        # Locked out? Show the exact remaining time and refuse to check the code.
        locked_until = cache.get(lock_key)
        if locked_until:
            remaining = int(locked_until - time.time())
            if remaining > 0:
                messages.error(
                    request,
                    f"Too many incorrect codes. Please wait {_humanize(remaining)} and try again.",
                )
                return redirect("login")

        form = LoginForm(request.POST)
        if form.is_valid():
            try:
                # Case-insensitive + trimmed so codes work however they're typed.
                code = form.cleaned_data["code"].strip()
                resident = Resident.objects.get(code__iexact=code)
            except Resident.DoesNotExist:
                # Wrong guess: bump the strike counter; lock out on the 3rd.
                attempts = (cache.get(attempts_key) or 0) + 1
                if attempts >= LOGIN_FAIL_LIMIT:
                    # Guaranteed full 5 minutes from *this* wrong guess.
                    cache.set(lock_key, time.time() + LOGIN_LOCKOUT_SECONDS, LOGIN_LOCKOUT_SECONDS)
                    cache.delete(attempts_key)  # start fresh once the lockout ends
                    messages.error(
                        request,
                        f"That code isn't right. Too many attempts — please wait "
                        f"{_humanize(LOGIN_LOCKOUT_SECONDS)} and try again.",
                    )
                else:
                    # Keep the counter alive for one lockout window.
                    cache.set(attempts_key, attempts, LOGIN_LOCKOUT_SECONDS)
                    left = LOGIN_FAIL_LIMIT - attempts
                    messages.error(
                        request,
                        f"That code isn't right. {left} attempt{'s' if left != 1 else ''} "
                        "left before a 5-minute timeout.",
                    )
                return redirect("login")

            # Correct code — clear any strikes and sign in.
            cache.delete(attempts_key)
            cache.delete(lock_key)
            request.session["resident_id"] = resident.id
            return redirect("choose")

        # Malformed input (e.g. not 6 characters) — surface it, don't penalize.
        for error in form.errors.get("code", []):
            messages.error(request, error)
        return redirect("login")

    return render(request, "alphabetcity/code.html", {"form": LoginForm()})


def _index_context(request):
    """Shared context for the Index page and its /tv/ (fullscreen) variant."""
    # Only answers the admin has left visible appear on the wall.
    all_answers_list = (
        Answer.objects.filter(visible=True)
        .select_related("question", "resident")
        .order_by("-pub_date")
    )

    # Give each question a stable 0-based index so the front-end can color its
    # dots (0 -> red, 1 -> yellow, 2 -> brown, then cycling).
    q_index = {q.id: i for i, q in enumerate(Question.objects.order_by("id"))}

    # Each answer becomes one interactive dot on the Index page. Only answers whose
    # owner code matches the signed-in resident are flagged "own" and carry
    # edit/delete URLs, so the pencil/trash controls appear on that resident's
    # bubbles alone.
    resident = _session_resident(request)
    answers_data = []
    for a in all_answers_list:
        item = {
            "id": a.id,
            "q": q_index.get(a.question_id, 0),
            "title": a.question.question_text,
            "body": a.answer_text,
        }
        if _owns_answer(resident, a):
            item["own"] = True
            item["editUrl"] = reverse("edit", args=[a.id])
            item["deleteUrl"] = reverse("delete", args=[a.id])
        answers_data.append(item)

    # A signed-in resident gets a "Back to my response" link in the corner. It
    # points to their submitted answer (edit page) if they have one; otherwise to
    # the answer page they were last writing on before jumping over to browse.
    my_response_url = None
    if resident and _is_vetted_demo_resident(resident):
        # Shared vetted code — always send the write button to the code page,
        # never to a specific "my answer".
        my_response_url = reverse("login")
    elif resident:
        own = Answer.objects.filter(resident=resident).order_by("-pub_date").first()
        if own:
            my_response_url = reverse("edit", args=[own.id])
        else:
            my_response_url = request.session.get("response_url") or reverse("choose")
    else:
        my_response_url = reverse("login")

    return {
        "all_answers_list": all_answers_list,
        "answers_data": answers_data,  # rendered via {{ ...|json_script }}
        "my_response_url": my_response_url,
    }


def index(request):
    return render(request, "alphabetcity/index.html", _index_context(request))


def tv(request):
    """Same wall as the Index page, but boots straight into fullscreen mode and
    stays there — for an unattended display (e.g. a gallery TV)."""
    context = _index_context(request)
    context["tv"] = True
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
    # Remember this page so "Back to my response" on the index can return here
    # if they hop over to browse before submitting.
    request.session["response_url"] = request.path
    return render(request, "alphabetcity/answer.html", {
        "form": form,
        "question": question,
        "form_action": reverse("answer", args=[question.pk]),
        "submit_label": "Send",
        "back_url": reverse("choose"),
        "is_vetted_demo": _is_vetted_demo_resident(resident),
    })

# Post-Answer
def detail_answer(request, answer_id):
    answer = get_object_or_404(Answer, pk=answer_id)
    return render(request, "detail.html", {"answer": answer})

def edit_answer(request, answer_id):
    a = get_object_or_404(Answer, id=answer_id)
    resident = _session_resident(request)
    if not _owns_answer(resident, a):
        messages.error(request, "Can't edit another person's post!")
        return redirect('index')

    if request.method == "POST":
        form = AnswerForm(request.POST, instance=a)
        if form.is_valid():
            form.save()
            messages.success(request, "Your response was updated.")
            return redirect('index')
    else:
        form = AnswerForm(instance=a)  # Populates form with existing data

    # Remember this page for the index's "Back to my response" link.
    request.session["response_url"] = request.path
    # Reuse the Answer page, pre-filled, posting back to this edit URL.
    return render(request, "alphabetcity/answer.html", {
        "form": form,
        "question": a.question,
        "form_action": reverse("edit", args=[a.id]),
        "submit_label": "Save",
        "back_url": reverse("choose"),
        "is_vetted_demo": _is_vetted_demo_resident(resident),
    })


def delete_answer(request, answer_id):
    a = get_object_or_404(Answer, id=answer_id)
    resident = _session_resident(request)
    if not _owns_answer(resident, a):
        messages.error(request, "Can't delete another person's post!")
        return redirect('index')

    if request.method == "POST":
        a.delete()
        messages.success(request, "Your response was deleted")
    return redirect('index')