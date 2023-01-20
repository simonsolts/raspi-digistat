FROM python:3.11
#
# RUN apt-get update && apt-get install -y libgeos-dev

WORKDIR /code

COPY requirements.txt /code/requirements.txt

RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY ./app /code/app

CMD ["python", "main.py"]
