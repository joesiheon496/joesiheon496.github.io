// C++ 글 프로토타입 — 버릴 코드. "조용히 틀리는" 후보들을 전수 측정한다.
// 교과서 문장을 옮겨 적지 않는다. 실제로 돌려서 나온 값만 쓴다.

#include <opencv2/opencv.hpp>
#include <iostream>
#include <iomanip>
#include <vector>

static void hdr(const char* s) { std::cout << "\n===== " << s << " =====\n"; }

int main() {
    std::cout << "OpenCV " << CV_VERSION << "\n";

    // ---------------------------------------------------------------
    hdr("1. 8비트 평균 — 어느 형태가 틀리는가");
    {
        auto mk = [](int v) { return cv::Mat(1, 1, CV_8U, cv::Scalar(v)); };
        auto val = [](const cv::Mat& m) { return (int)m.at<uchar>(0, 0); };

        for (auto pr : std::vector<std::pair<int,int>>{{200,100},{201,101},{255,255},{7,8}}) {
            int A = pr.first, B = pr.second;
            cv::Mat a = mk(A), b = mk(B);
            double truth = (A + B) / 2.0;

            cv::Mat e1 = (a + b) / 2;                  // MatExpr 한 줄
            cv::Mat sum; cv::add(a, b, sum);           // 명시적 add — 여기서 포화
            cv::Mat e2 = sum / 2;
            cv::Mat e3 = a / 2 + b / 2;                // 각각 나눈 뒤 더하기
            cv::Mat e4; cv::addWeighted(a, 0.5, b, 0.5, 0.0, e4);
            cv::Mat a16, b16, e5;                      // 16비트로 올려서
            a.convertTo(a16, CV_16U); b.convertTo(b16, CV_16U);
            cv::Mat s16; cv::add(a16, b16, s16);       // 16U 에서는 포화 안 됨
            cv::Mat h16 = s16 / 2;
            h16.convertTo(e5, CV_8U);
            uchar ca = (uchar)A, cb = (uchar)B;
            int raw = (ca + cb) / 2;                   // 순수 C++ (정수 승격)

            std::cout << "  (" << A << "," << B << ") 참값 " << truth
                      << " | MatExpr " << val(e1)
                      << " | add후/2 " << val(e2)
                      << " | a/2+b/2 " << val(e3)
                      << " | addWeighted " << val(e4)
                      << " | 16U경유 " << val(e5)
                      << " | 순수C++ " << raw
                      << " | add단독 " << val(sum) << "\n";
        }
    }

    // ---------------------------------------------------------------
    hdr("2. 얕은 복사 — 어디까지 데이터를 공유하는가");
    {
        cv::Mat base = cv::Mat::zeros(4, 4, CV_8U);
        cv::Mat assign = base;                   // 대입
        cv::Mat roi = base(cv::Rect(1, 1, 2, 2));
        cv::Mat cloned = base.clone();
        cv::Mat header = base.reshape(1, 2);     // 헤더만 바꿈
        cv::Mat converted; base.convertTo(converted, CV_8U);   // 같은 타입으로 변환

        base.at<uchar>(1, 1) = 77;
        std::cout << "  base 를 77 로 고친 뒤 —\n"
                  << "    대입본     " << (int)assign.at<uchar>(1,1)
                  << "  (data 포인터 같은가: " << (assign.data == base.data) << ")\n"
                  << "    ROI        " << (int)roi.at<uchar>(0,0)
                  << "  (같은가: " << (roi.data == base.data + base.step + 1) << ")\n"
                  << "    clone      " << (int)cloned.at<uchar>(1,1) << "\n"
                  << "    reshape    " << (int)header.at<uchar>(0,5)
                  << "  (같은가: " << (header.data == base.data) << ")\n"
                  << "    convertTo  " << (int)converted.at<uchar>(1,1)
                  << "  (같은가: " << (converted.data == base.data) << ")\n";
    }

    // ---------------------------------------------------------------
    hdr("3. stride — cols 로 인덱싱하면 언제 틀리는가");
    {
        cv::Mat full(6, 5, CV_8U);
        for (int y = 0; y < 6; y++) for (int x = 0; x < 5; x++) full.at<uchar>(y,x) = y*10 + x;
        cv::Mat roi = full(cv::Rect(1, 1, 3, 3));

        std::cout << "  full: cols=" << full.cols << " step=" << full.step
                  << " isContinuous=" << full.isContinuous() << "\n";
        std::cout << "  roi : cols=" << roi.cols << " step=" << roi.step
                  << " isContinuous=" << roi.isContinuous() << "\n";
        const uchar* p = roi.ptr<uchar>();
        std::cout << "  roi(1,1) 참값 " << (int)roi.at<uchar>(1,1)
                  << " | p[1*cols+1] = " << (int)p[1*roi.cols + 1]
                  << " | p[1*step+1] = " << (int)p[1*roi.step + 1]
                  << " | ptr(1)[1] = " << (int)roi.ptr<uchar>(1)[1] << "\n";
        // 큰 이미지에서 정렬 패딩이 생기는지
        for (int w : {640, 641, 643, 1000}) {
            cv::Mat m(4, w, CV_8U);
            std::cout << "    width " << w << " → step " << m.step
                      << (m.step == (size_t)w ? "  (패딩 없음)" : "  (패딩 있음!)") << "\n";
        }
    }

    // ---------------------------------------------------------------
    hdr("4. resize 의 화소 중심 규약 — 반 화소가 어디서 생기는가");
    {
        // 1행 램프. 2배 확대해 어떤 대응이 쓰였는지 역산한다
        cv::Mat src(1, 8, CV_32F);
        for (int i = 0; i < 8; i++) src.at<float>(0,i) = (float)i;
        cv::Mat up;
        cv::resize(src, up, cv::Size(16, 1), 0, 0, cv::INTER_LINEAR);
        std::cout << "  src = 0..7, INTER_LINEAR 로 16 폭 확대:\n   ";
        for (int i = 0; i < 16; i++) std::cout << " " << std::fixed << std::setprecision(2) << up.at<float>(0,i);
        std::cout << "\n";
        // 두 가설의 예측
        std::cout << "  가설A dst=src*scale (중심 정수)  예측 i=1 → " << (1 * 0.5) << "\n";
        std::cout << "  가설B dst=(i+0.5)*scale-0.5      예측 i=1 → " << ((1 + 0.5) * 0.5 - 0.5) << "\n";
        std::cout << "  실측 i=1 → " << up.at<float>(0,1) << "\n";
        // INTER_NEAREST 도
        cv::Mat nn; cv::resize(src, nn, cv::Size(16,1), 0, 0, cv::INTER_NEAREST);
        std::cout << "  INTER_NEAREST:";
        for (int i = 0; i < 16; i++) std::cout << " " << (int)nn.at<float>(0,i);
        std::cout << "\n";
        // warpAffine 항등변환이 값을 보존하는가
        cv::Mat eye = (cv::Mat_<double>(2,3) << 1,0,0, 0,1,0);
        cv::Mat warped; cv::warpAffine(src, warped, eye, src.size(), cv::INTER_LINEAR);
        double maxdiff = cv::norm(src, warped, cv::NORM_INF);
        std::cout << "  warpAffine 항등변환 최대 오차 " << maxdiff << "\n";
        // 0.5 화소 이동을 왕복하면 얼마나 잃는가
        cv::Mat halfR = (cv::Mat_<double>(2,3) << 1,0,0.5, 0,1,0);
        cv::Mat halfL = (cv::Mat_<double>(2,3) << 1,0,-0.5, 0,1,0);
        cv::Mat t1, t2;
        cv::warpAffine(src, t1, halfR, src.size(), cv::INTER_LINEAR, cv::BORDER_REFLECT);
        cv::warpAffine(t1, t2, halfL, src.size(), cv::INTER_LINEAR, cv::BORDER_REFLECT);
        std::cout << "  0.5 px 왕복 후 최대 오차 " << cv::norm(src, t2, cv::NORM_INF)
                  << " (원값 범위 0~7)\n";
    }

    // ---------------------------------------------------------------
    hdr("5. at<T>(y,x) 와 Point(x,y) 를 섞으면");
    {
        cv::Mat m = cv::Mat::zeros(3, 6, CV_8U);       // rows=3, cols=6
        m.at<uchar>(1, 4) = 99;                        // (y=1, x=4)
        std::cout << "  at<uchar>(1,4)=99 을 넣었다\n";
        std::cout << "    at<uchar>(1,4) = " << (int)m.at<uchar>(1,4) << "\n";
        std::cout << "    at<uchar>(cv::Point(4,1)) = " << (int)m.at<uchar>(cv::Point(4,1)) << "\n";
        std::cout << "    at<uchar>(cv::Point(1,4)) = ";
        // (1,4) 를 Point 로 주면 x=1,y=4 → rows=3 밖. 접근하면 UB 이므로 범위만 보고한다
        std::cout << "행 4 는 rows=3 밖 — 접근 자체가 UB\n";
        std::cout << "    Size(6,3) 과 Mat(3,6) 이 같은 크기인가: "
                  << (m.size() == cv::Size(6,3)) << "\n";
    }

    // ---------------------------------------------------------------
    hdr("6. 초기화하지 않은 Mat");
    {
        int nonzero = 0, trials = 200;
        for (int k = 0; k < trials; k++) {
            cv::Mat m(8, 8, CV_8U);          // zeros 아님
            if (cv::countNonZero(m) != 0) nonzero++;
        }
        std::cout << "  Mat(8,8,CV_8U) 200회 중 0 이 아닌 값을 담은 것: " << nonzero << "\n";
        std::cout << "  (0 이 나와도 보장이 아니다 — 할당자가 준 메모리에 달렸다)\n";
    }

    // ---------------------------------------------------------------
    hdr("7. float 누적 — 언제 자리수를 잃는가");
    {
        // 같은 값을 N 번 더하기
        for (int N : {1000, 100000, 10000000}) {
            float sf = 0.f; double sd = 0.0;
            for (int i = 0; i < N; i++) { sf += 0.1f; sd += 0.1; }
            std::cout << "  0.1 을 " << N << "회: float " << std::setprecision(9) << sf
                      << " | double " << sd
                      << " | 상대오차 " << std::scientific << std::abs(sf - sd) / sd << std::fixed << "\n";
        }
        // 조건수 나쁜 최소자승을 float 로
        std::cout << "  --- 나쁜 조건수 최소자승 (Hilbert 6x6) ---\n";
        for (int type : {CV_32F, CV_64F}) {
            cv::Mat H(6, 6, type), b(6, 1, type);
            for (int i = 0; i < 6; i++) {
                double bs = 0;
                for (int j = 0; j < 6; j++) {
                    double v = 1.0 / (i + j + 1);
                    if (type == CV_32F) H.at<float>(i,j) = (float)v; else H.at<double>(i,j) = v;
                    bs += v;                       // 정답이 전부 1 이 되도록
                }
                if (type == CV_32F) b.at<float>(i,0) = (float)bs; else b.at<double>(i,0) = bs;
            }
            cv::Mat x; cv::solve(H, b, x, cv::DECOMP_SVD);
            cv::Mat x64; x.convertTo(x64, CV_64F);
            cv::Mat ones = cv::Mat::ones(6, 1, CV_64F);
            std::cout << "    " << (type == CV_32F ? "float " : "double")
                      << " 해의 최대오차 " << std::scientific
                      << cv::norm(x64, ones, cv::NORM_INF) << std::fixed << "\n";
        }
    }

    // ---------------------------------------------------------------
    hdr("8. at<T> 의 타입이 틀리면");
    {
        cv::Mat f(1, 4, CV_32F);
        for (int i = 0; i < 4; i++) f.at<float>(0,i) = 1.0f + i;
        std::cout << "  CV_32F 에 1,2,3,4 를 넣고 at<uchar> 로 읽으면: ";
        for (int i = 0; i < 4; i++) std::cout << (int)f.at<uchar>(0,i) << " ";
        std::cout << "\n  (컴파일도 되고 크래시도 안 난다 — 바이트를 그대로 읽는다)\n";
        std::cout << "  1.0f 의 첫 바이트: " << (int)f.at<uchar>(0,0) << "\n";
    }

    return 0;
}
