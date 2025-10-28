import ast

import fastapi
import uvicorn
import pydantic
from fastapi.middleware.cors import CORSMiddleware

from shared_lib.model import CodeRequest

app = fastapi.FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/")
async def analyze_code(snippet: CodeRequest):
    print("Received code snippet for analysis.")
    print(snippet.code)
    # Placeholder for code analysis logic
    analysis_result = {"length": len(snippet.code), "lines": snippet.code.count("\n") + 1}
    return analysis_result

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)