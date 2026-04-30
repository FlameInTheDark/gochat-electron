#include <Windows.h>
#include <fcntl.h>
#include <io.h>
#include <iostream>
#include <string>

#include "LoopbackCapture.h"

static void usage()
{
    std::wcerr <<
        L"Usage: gochat-app-loopback-capture (--pid <pid> | --source-id <electron-source-id>)\n"
        L"\n"
        L"Streams raw signed 16-bit little-endian PCM to stdout: 44100 Hz, stereo.\n"
        L"The selected process tree is captured using Windows Application Loopback.\n";
}

static bool parseSourceIdToHwnd(const wchar_t* sourceId, HWND* hwnd)
{
    if (!sourceId || !hwnd) return false;

    const std::wstring value(sourceId);
    const std::wstring prefix = L"window:";
    if (value.rfind(prefix, 0) != 0) return false;

    const size_t start = prefix.size();
    const size_t end = value.find(L':', start);
    if (end == std::wstring::npos || end <= start) return false;

    const std::wstring handlePart = value.substr(start, end - start);
    wchar_t* parseEnd = nullptr;
    unsigned long long handleValue = wcstoull(handlePart.c_str(), &parseEnd, 0);
    if (!parseEnd || *parseEnd != L'\0' || handleValue == 0) return false;

    *hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(handleValue));
    return true;
}

static DWORD pidFromSourceId(const wchar_t* sourceId)
{
    HWND hwnd = nullptr;
    if (!parseSourceIdToHwnd(sourceId, &hwnd)) return 0;

    DWORD processId = 0;
    GetWindowThreadProcessId(hwnd, &processId);
    return processId;
}

int wmain(int argc, wchar_t* argv[])
{
    DWORD processId = 0;

    for (int i = 1; i < argc; ++i)
    {
        if (wcscmp(argv[i], L"--pid") == 0 && i + 1 < argc)
        {
            processId = wcstoul(argv[++i], nullptr, 0);
        }
        else if (wcscmp(argv[i], L"--source-id") == 0 && i + 1 < argc)
        {
            processId = pidFromSourceId(argv[++i]);
        }
        else
        {
            usage();
            return 2;
        }
    }

    if (processId == 0)
    {
        usage();
        return 2;
    }

    _setmode(_fileno(stdout), _O_BINARY);

    HANDLE outputHandle = GetStdHandle(STD_OUTPUT_HANDLE);
    if (outputHandle == INVALID_HANDLE_VALUE || outputHandle == nullptr)
    {
        std::wcerr << L"stdout is not available\n";
        return 3;
    }

    CLoopbackCapture loopbackCapture;
    HRESULT hr = loopbackCapture.StartCaptureAsync(processId, true, outputHandle);
    if (FAILED(hr))
    {
        wil::unique_hlocal_string message;
        FormatMessageW(
            FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS | FORMAT_MESSAGE_ALLOCATE_BUFFER,
            nullptr,
            hr,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
            reinterpret_cast<PWSTR>(&message),
            0,
            nullptr);
        std::wcerr << L"Failed to start application loopback capture\n0x" << std::hex << hr << L": " << message.get() << L"\n";
        return 4;
    }

    char buffer = 0;
    DWORD bytesRead = 0;
    HANDLE inputHandle = GetStdHandle(STD_INPUT_HANDLE);
    while (inputHandle != INVALID_HANDLE_VALUE && inputHandle != nullptr)
    {
        if (!ReadFile(inputHandle, &buffer, 1, &bytesRead, nullptr) || bytesRead == 0)
        {
            break;
        }
    }

    loopbackCapture.StopCaptureAsync();
    return 0;
}
