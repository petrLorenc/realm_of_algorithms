import requests
from nicegui.events import ValueChangeEventArguments
from nicegui import ui

def send_message(message: ValueChangeEventArguments):
    ui.notify(f'You sent: {message.value}')
    response = requests.post(
        "http://localhost:8000/",
        json={"code": message.value}
    )

ui.label('Hello NiceGUI!')
ui.textarea(label='Text', placeholder='start typing',
            on_change=send_message)
result = ui.label()

ui.run()
ui.run()