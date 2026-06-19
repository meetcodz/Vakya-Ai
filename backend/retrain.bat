@echo off
echo ==============================================
echo Retraining Intent Classifier Model
echo ==============================================
cd /d "%~dp0"
call .\venv\Scripts\activate.bat
python train.py
echo ==============================================
echo Retraining complete!
pause
