import os
import sys
import uvicorn

# 将项目根目录与 backend 目录加入 Python 模块搜索路径
current_dir = os.path.abspath(os.path.dirname(__file__))
sys.path.append(current_dir)
sys.path.append(os.path.join(current_dir, "backend"))

# 导入 FastAPI app 实例
try:
    from backend.server import app
except ImportError:
    from server import app

if __name__ == "__main__":
    # Hugging Face Spaces 默认将容器的 7860 端口暴露到公网
    port = int(os.environ.get("PORT", 7860))
    print(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
