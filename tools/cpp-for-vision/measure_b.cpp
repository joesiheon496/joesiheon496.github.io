// C++ 글 프로토타입 2차 — expression template, 성능, BGR, 외부 버퍼 수명.

#include <opencv2/opencv.hpp>
#include <iostream>
#include <iomanip>
#include <chrono>
#include <vector>
#include <numeric>

static void hdr(const char* s) { std::cout << "\n===== " << s << " =====\n"; }
using clk = std::chrono::steady_clock;
static double ms(clk::time_point a, clk::time_point b) {
    return std::chrono::duration<double, std::milli>(b - a).count();
}

// auto 로 받은 MatExpr 가 임시를 참조하는 경우
static cv::MatExpr makeExpr() {
    cv::Mat a = cv::Mat::ones(4, 4, CV_32F) * 3;
    cv::Mat b = cv::Mat::ones(4, 4, CV_32F) * 4;
    return a + b;                     // a, b 가 여기서 죽는다
}
// 외부 버퍼를 감싼 Mat
static cv::Mat wrapVector() {
    std::vector<float> v(16, 5.0f);
    return cv::Mat(4, 4, CV_32F, v.data());   // v 가 여기서 죽는다
}

int main() {
    std::cout << "OpenCV " << CV_VERSION << "\n";

    hdr("9. auto 로 받은 expression template");
    {
        cv::Mat a = cv::Mat::ones(2, 2, CV_32F) * 3;
        cv::Mat b = cv::Mat::ones(2, 2, CV_32F) * 4;
        auto e = a + b;                       // MatExpr — 아직 계산 안 됨
        std::cout << "  auto e = a + b 의 타입이 Mat 인가: "
                  << std::is_same<decltype(e), cv::Mat>::value << "\n";
        a.setTo(100);                          // 나중에 a 를 고친다
        cv::Mat r = e;                         // 여기서 계산된다
        std::cout << "  a 를 100 으로 고친 뒤 e 를 평가: " << r.at<float>(0,0)
                  << "   (a+b 를 즉시 계산했다면 7, 지연 계산이면 104)\n";

        cv::Mat dangling = makeExpr();         // 죽은 지역변수를 참조하는 식
        std::cout << "  죽은 지역변수를 참조하는 MatExpr 평가 → " << dangling.at<float>(0,0)
                  << "   (기대 7, 아니면 UB 가 값으로 드러난 것)\n";

        cv::Mat wrapped = wrapVector();
        std::cout << "  죽은 vector 를 감싼 Mat → " << wrapped.at<float>(0,0)
                  << "   (기대 5, 아니면 해제된 메모리)\n";
        std::cout << "  그 Mat 이 데이터를 소유하는가 (refcount 존재): "
                  << (wrapped.u != nullptr) << "\n";
    }

    hdr("10. 화소 접근 방식별 속도 (2000x2000 CV_8U, 5회 중 최소)");
    {
        const int N = 2000;
        cv::Mat m(N, N, CV_8U, cv::Scalar(3));
        std::vector<double> tAt, tPtr, tData, tOcv;
        long long sink = 0;
        for (int rep = 0; rep < 5; rep++) {
            { auto t0 = clk::now(); long long s = 0;
              for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) s += m.at<uchar>(y,x);
              tAt.push_back(ms(t0, clk::now())); sink += s; }
            { auto t0 = clk::now(); long long s = 0;
              for (int y = 0; y < N; y++) { const uchar* p = m.ptr<uchar>(y);
                for (int x = 0; x < N; x++) s += p[x]; }
              tPtr.push_back(ms(t0, clk::now())); sink += s; }
            { auto t0 = clk::now(); long long s = 0;
              const uchar* p = m.data;
              for (size_t i = 0; i < m.total(); i++) s += p[i];
              tData.push_back(ms(t0, clk::now())); sink += s; }
            { auto t0 = clk::now();
              cv::Scalar sc = cv::sum(m);
              tOcv.push_back(ms(t0, clk::now())); sink += (long long)sc[0]; }
        }
        auto mn = [](std::vector<double>& v) { return *std::min_element(v.begin(), v.end()); };
        double a = mn(tAt), p = mn(tPtr), d = mn(tData), o = mn(tOcv);
        std::cout << std::fixed << std::setprecision(2)
                  << "  at<uchar>(y,x)  " << a << " ms  (1.00x)\n"
                  << "  ptr<uchar>(y)[x] " << p << " ms  (" << a/p << "x 빠름)\n"
                  << "  data[i] 연속 가정 " << d << " ms  (" << a/d << "x)\n"
                  << "  cv::sum          " << o << " ms  (" << a/o << "x)\n"
                  << "  (sink " << (sink != 0) << ")\n";
        // 디버그 빌드에서 at<> 가 경계검사를 하는지
        std::cout << "  이 빌드에 CV_DBG_ASSERT 활성: "
#ifdef _DEBUG
                  << "예 (Debug — at<> 가 훨씬 느리다)\n";
#else
                  << "아니오 (Release)\n";
#endif
    }

    hdr("11. 안쪽 루프의 clone");
    {
        const int N = 500;
        cv::Mat m(N, N, CV_8U, cv::Scalar(1));
        auto t0 = clk::now(); long long s = 0;
        for (int y = 0; y < N; y++) { cv::Mat row = m.row(y); s += row.at<uchar>(0,0); }
        double noClone = ms(t0, clk::now());
        t0 = clk::now(); s = 0;
        for (int y = 0; y < N; y++) { cv::Mat row = m.row(y).clone(); s += row.at<uchar>(0,0); }
        double withClone = ms(t0, clk::now());
        std::cout << "  row 헤더만 " << noClone << " ms · row().clone() " << withClone
                  << " ms  (" << (withClone / std::max(noClone, 1e-9)) << "x)\n";
    }

    hdr("12. imwrite/imread 의 채널 순서");
    {
        // 순수한 빨강을 BGR 로 만들어 PNG 로 쓰고 다시 읽는다
        cv::Mat bgr(1, 1, CV_8UC3, cv::Scalar(0, 0, 255));   // B=0 G=0 R=255
        cv::imwrite("chan.png", bgr);
        cv::Mat back = cv::imread("chan.png", cv::IMREAD_COLOR);
        cv::Vec3b v = back.at<cv::Vec3b>(0,0);
        std::cout << "  Scalar(0,0,255) 로 만들고 PNG 왕복 → ("
                  << (int)v[0] << "," << (int)v[1] << "," << (int)v[2] << ")\n";
        std::cout << "  즉 imread 가 주는 순서는 " << (v[2] == 255 ? "BGR" : "RGB") << "\n";
        // split 이 주는 순서
        std::vector<cv::Mat> ch; cv::split(back, ch);
        std::cout << "  split 후 채널 0 의 값 " << (int)ch[0].at<uchar>(0,0)
                  << " · 채널 2 의 값 " << (int)ch[2].at<uchar>(0,0) << "\n";
        // cvtColor 로 RGB 로 바꾸면
        cv::Mat rgb; cv::cvtColor(back, rgb, cv::COLOR_BGR2RGB);
        cv::Vec3b w = rgb.at<cv::Vec3b>(0,0);
        std::cout << "  BGR2RGB 후 → (" << (int)w[0] << "," << (int)w[1] << "," << (int)w[2] << ")\n";
        std::remove("chan.png");
    }

    hdr("13. saturate_cast 는 반올림인가 절단인가");
    {
        std::cout << "  saturate_cast<uchar>: ";
        for (double v : {-1.0, 0.4, 0.5, 0.6, 1.5, 2.5, 254.5, 255.5, 300.0})
            std::cout << v << "→" << (int)cv::saturate_cast<uchar>(v) << "  ";
        std::cout << "\n  C 스타일 (uchar)cast: ";
        for (double v : {0.4, 0.5, 0.6, 1.5, 2.5})
            std::cout << v << "→" << (int)(uchar)v << "  ";
        std::cout << "\n  (0.5 와 2.5 를 보면 반올림 방식이 드러난다)\n";
    }

    hdr("14. 나눗셈에서 0 으로 나누면");
    {
        cv::Mat a = (cv::Mat_<float>(1,3) << 1, 2, 3);
        cv::Mat b = (cv::Mat_<float>(1,3) << 1, 0, 3);
        cv::Mat q = a / b;
        std::cout << "  float 나눗셈 [1,2,3]/[1,0,3] → ";
        for (int i = 0; i < 3; i++) std::cout << q.at<float>(0,i) << " ";
        std::cout << "  (inf 가 아니라 0 이면 OpenCV 가 막은 것)\n";
        cv::Mat ai = (cv::Mat_<uchar>(1,3) << 1, 2, 3);
        cv::Mat bi = (cv::Mat_<uchar>(1,3) << 1, 0, 3);
        cv::Mat qi; cv::divide(ai, bi, qi);
        std::cout << "  8U divide → ";
        for (int i = 0; i < 3; i++) std::cout << (int)qi.at<uchar>(0,i) << " ";
        std::cout << "\n";
    }

    return 0;
}
