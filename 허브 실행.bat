@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo 니케 허브를 켭니다. 이 창을 닫으면 허브도 꺼집니다.
start "" http://localhost:8765/
python -m http.server 8765
