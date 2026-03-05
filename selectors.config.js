/**
 * 셀렉터 설정 파일
 * 사이트 구조가 변경되면 이 파일만 수정하면 됩니다.
 *
 * 장점:
 * - 코드 전체를 수정할 필요 없이 셀렉터만 변경
 * - 여러 스크립트에서 공통으로 사용 가능
 * - 변경 이력 추적 용이
 */

export const NAVER_SELECTORS = {
  login: {
    // 아이디 입력 필드
    idInput: { role: 'textbox', name: '아이디 또는 전화번호' },

    // 비밀번호 입력 필드
    pwInput: { role: 'textbox', name: '비밀번호' },

    // 로그인 버튼
    loginButton: { role: 'button', name: '로그인', exact: true },

    // 로그인 상태 유지 체크박스
    keepLogin: { role: 'checkbox', name: '로그인 상태 유지' },
  },

  urls: {
    login: 'https://nid.naver.com/nidlogin.login',
    main: 'https://www.naver.com/',
  }
};

// 다른 사이트 추가 예시
export const GOOGLE_SELECTORS = {
  search: {
    searchInput: { role: 'combobox', name: 'Search' },
    searchButton: { role: 'button', name: 'Google Search' },
  },
  urls: {
    main: 'https://www.google.com/',
  }
};
